/* ==========================================================================
 * task-manager.js - Cancelable task queue with progress tracking
 *
 * Manages long-running tasks: report generation, profile building, env test.
 * Supports cancel signals, progress updates, queuing, and history persistence.
 * ========================================================================== */

"use strict";

(function () {
  const LOG_PREFIX = "arxiv-interest-daily";

  function log(msg) {
    const text = "[" + LOG_PREFIX + "] " + msg;
    if (typeof Zotero.debug === "function") Zotero.debug(text);
    else if (typeof Zotero.log === "function") Zotero.log(text);
  }

  function logError(msg) {
    if (typeof Zotero.logError === "function") Zotero.logError(msg);
    else log("ERROR: " + msg);
  }

  const EXCLUSIVE_TYPES = ["generateReport", "buildProfile", "updateFeedback"];

  globalThis.ArxivDailyTaskManager = {
    _tasks: {},         // taskId -> TaskState
    _queue: [],         // queued task descriptors
    _running: null,     // currently running taskId
    _idCounter: 0,
    _cancelTokens: {},  // taskId -> { cancelled: false }
    _listeners: [],     // progress change callbacks

    // Create and start a task. Returns taskId.
    //   type: string identifying the task category
    //   label: human-readable label
    //   runner: async function(cancelToken, onProgress)
    start: function (type, label, runner) {
      var taskId = "task_" + (++this._idCounter) + "_" + Date.now();
      var now = Date.now();

      var task = {
        id: taskId,
        type: type,
        label: label,
        status: "pending", // pending | running | completed | failed | cancelled
        progress: 0,
        currentStep: "",
        progressLog: [],
        log: [],
        _lastLogMessage: "",
        createdAt: now,
        startedAt: null,
        completedAt: null,
        error: null,
      };

      this._tasks[taskId] = task;

      var needExclusive = EXCLUSIVE_TYPES.indexOf(type) >= 0;
      if (needExclusive && this._running) {
        this._queue.push({ taskId: taskId, type: type, runner: runner });
        this._appendLog(taskId, "queued (waiting for running task to finish)");
        this._notify();
        return taskId;
      }

      this._startTask(taskId, runner);
      return taskId;
    },

    // Cancel a task by ID.
    cancel: function (taskId) {
      var token = this._cancelTokens[taskId];
      if (token) {
        token.cancelled = true;
      }

      var task = this._tasks[taskId];
      if (task && task.status === "pending") {
        this._removeQueuedTask(taskId);
      }

      if (task && (task.status === "pending" || task.status === "running")) {
        task.status = "cancelled";
        task.currentStep = "Cancelled";
        task.completedAt = Date.now();
        this._appendLog(taskId, "cancelled by user");
        this._notify();
      }
    },

    // Cancel all running and queued tasks.
    cancelAll: function () {
      for (var id in this._cancelTokens) {
        this._cancelTokens[id].cancelled = true;
      }
      for (var taskId in this._tasks) {
        var task = this._tasks[taskId];
        if (task.status === "pending" || task.status === "running") {
          task.status = "cancelled";
          task.currentStep = "Cancelled";
          task.completedAt = Date.now();
        }
      }
      this._queue = [];
      this._notify();
    },

    // Remove a finished or queued task from the visible progress history.
    // Running tasks stay visible so the shared progress bar keeps working.
    dismiss: function (taskId) {
      var task = this._tasks[taskId];
      if (!task) return false;
      if (taskId === this._running || task.status === "running") {
        return false;
      }

      this._removeQueuedTask(taskId);
      delete this._cancelTokens[taskId];
      delete this._tasks[taskId];
      this._notify();
      return true;
    },

    getTask: function (taskId) {
      return this._tasks[taskId] || null;
    },

    getAllTasks: function () {
      var result = [];
      for (var id in this._tasks) {
        result.push(this._tasks[id]);
      }
      result.sort(function (a, b) {
        return b.createdAt - a.createdAt;
      });
      return result;
    },

    getRunningTask: function () {
      if (this._running && this._tasks[this._running]) {
        return this._tasks[this._running];
      }
      return null;
    },

    getQueuedTasks: function () {
      var self = this;
      return this._queue
        .map(function (queued) {
          return self._tasks[queued.taskId];
        })
        .filter(function (task) {
          return !!task;
        });
    },

    onChange: function (callback) {
      this._listeners.push(callback);
    },

    offChange: function (callback) {
      var idx = this._listeners.indexOf(callback);
      if (idx >= 0) this._listeners.splice(idx, 1);
    },

    _startTask: function (taskId, runner) {
      var self = this;
      var task = this._tasks[taskId];
      if (!task) return;

      task.status = "running";
      task.startedAt = Date.now();
      this._running = taskId;

      var token = { cancelled: false };
      this._cancelTokens[taskId] = token;

      var onProgress = function (step, pct) {
        if (step) {
          task.currentStep = step;
          self._appendLog(taskId, step);
        }
        if (pct !== undefined) {
          task.progress = Math.min(100, Math.max(0, pct));
        }
        self._appendProgress(taskId, task.currentStep || step || "", task.progress);
        self._notify();
      };

      this._appendLog(taskId, "started");
      this._appendProgress(taskId, "Started", 0);
      this._notify();

      runner(token, onProgress).then(function () {
        if (!token.cancelled) {
          task.status = "completed";
          task.progress = 100;
          task.currentStep = "Complete";
          task.completedAt = Date.now();
          self._appendLog(taskId, "completed");
          self._appendProgress(taskId, "Complete", 100);
          self._saveHistory(task);
        }
        self._finishTask(taskId);
      }).catch(function (err) {
        if (token.cancelled) {
          task.status = "cancelled";
          task.currentStep = "Cancelled";
          self._appendLog(taskId, "cancelled");
          self._appendProgress(taskId, "Cancelled", task.progress);
        } else {
          task.status = "failed";
          task.currentStep = "Failed";
          task.error = err && err.message ? err.message : String(err);
          self._appendLog(taskId, "failed: " + task.error);
          self._appendProgress(taskId, "Failed", task.progress);
          self._saveHistory(task);
        }
        self._finishTask(taskId);
      });
    },

    _finishTask: function (taskId) {
      if (this._running === taskId) {
        this._running = null;
      }
      delete this._cancelTokens[taskId];
      this._notify();

      while (!this._running && this._queue.length > 0) {
        var next = this._queue.shift();
        var nextTask = this._tasks[next.taskId];
        if (!nextTask || nextTask.status !== "pending") {
          continue;
        }
        if (typeof next.runner !== "function") {
          this._appendLog(next.taskId, "dequeued but runner not available - please retry");
          continue;
        }
        this._appendLog(next.taskId, "starting queued task");
        this._startTask(next.taskId, next.runner);
        return;
      }
    },

    _removeQueuedTask: function (taskId) {
      this._queue = this._queue.filter(function (queued) {
        return queued.taskId !== taskId;
      });
    },

    _appendLog: function (taskId, message) {
      var task = this._tasks[taskId];
      if (!task) return;
      if (task._lastLogMessage === message) return;
      task._lastLogMessage = message;
      var entry = "[" + new Date().toLocaleTimeString() + "] " + message;
      task.log.push(entry);
      if (task.log.length > 100) {
        task.log.splice(0, task.log.length - 100);
      }
    },

    _appendProgress: function (taskId, step, pct) {
      var task = this._tasks[taskId];
      if (!task) return;
      if (!task.progressLog) task.progressLog = [];
      var progress = Math.min(100, Math.max(0, pct || 0));
      var label = step || task.currentStep || "";
      var last = task.progressLog.length ? task.progressLog[task.progressLog.length - 1] : null;
      if (last && last.step === label && last.progress === progress) return;
      task.progressLog.push({
        time: new Date().toLocaleTimeString(),
        step: label,
        progress: progress,
      });
      if (task.progressLog.length > 40) {
        task.progressLog.splice(0, task.progressLog.length - 40);
      }
    },

    _saveHistory: function (task) {
      try {
        if (typeof ArxivDailyDataDir !== "undefined") {
          var history = ArxivDailyDataDir.readJSON("tasks/task_history.json") || [];
          history.push({
            id: task.id,
            type: task.type,
            label: task.label,
            status: task.status,
            createdAt: task.createdAt,
            completedAt: task.completedAt,
            error: task.error,
          });
          if (history.length > 50) {
            history = history.slice(history.length - 50);
          }
          ArxivDailyDataDir.writeJSON("tasks/task_history.json", history);
        }
      } catch (e) {
        logError("task history save failed: " + (e && e.message ? e.message : e));
      }
    },

    _notify: function () {
      for (var i = 0; i < this._listeners.length; i++) {
        try {
          this._listeners[i](this._tasks, this._running);
        } catch (e) {}
      }
    },
  };
})();
