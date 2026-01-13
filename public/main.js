/* ===========================================
   7-ELEVEN MESSAGE BUILDER - MAIN JS
   =========================================== */

// --- STATE ---
let verifiedUsers = [];
let tasks = [createEmptyTask()];

// --- DOM ELEMENTS ---
const elements = {
  // Tabs
  tabs: document.querySelectorAll(".tab"),
  tabContents: document.querySelectorAll(".tab-content"),

  // Step 1: Store IDs
  storeIdsInput: document.getElementById("storeIds"),
  verifyBtn: document.getElementById("verifyBtn"),
  verifyResults: document.getElementById("verifyResults"),

  // Step 2: Message Details
  titleInput: document.getElementById("title"),
  departmentSelect: document.getElementById("department"),

  // Step 3: Tasks
  tasksContainer: document.getElementById("tasksContainer"),
  addTaskBtn: document.getElementById("addTaskBtn"),
  taskCountNum: document.getElementById("taskCountNum"),

  // Submit
  submitBtn: document.getElementById("submitBtn"),

  // History
  historyContainer: document.getElementById("historyContainer"),
  filterStoreId: document.getElementById("filterStoreId"),
  filterBtn: document.getElementById("filterBtn"),
};

// --- INITIALIZATION ---
document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initVerification();
  initTasks();
  initSubmit();
  initHistory();
  renderTasks();
});

// --- TAB SWITCHING ---
function initTabs() {
  elements.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      // Update active states
      elements.tabs.forEach((t) => t.classList.remove("active"));
      elements.tabContents.forEach((c) => c.classList.remove("active"));

      tab.classList.add("active");
      document.getElementById(`${tab.dataset.tab}-tab`).classList.add("active");

      // Load history when switching to that tab
      if (tab.dataset.tab === "history") {
        loadHistory();
      }
    });
  });
}

// --- USER VERIFICATION ---
function initVerification() {
  elements.verifyBtn.addEventListener("click", verifyUsers);
}

async function verifyUsers() {
  const ids = elements.storeIdsInput.value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    showVerifyResult("warning", "Please enter at least one Store ID");
    return;
  }

  setButtonLoading(elements.verifyBtn, true, "Verifying...");

  try {
    const res = await fetch("/api/verify-users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeIds: ids }),
    });

    const data = await res.json();
    verifiedUsers = data.foundUsers || [];

    let html = "";
    if (verifiedUsers.length > 0) {
      html += createAlert(
        "success",
        `<strong>${verifiedUsers.length} stores verified successfully</strong>`
      );
    }
    if (data.notFoundIds && data.notFoundIds.length > 0) {
      html += createAlert(
        "warning",
        `<strong>${data.notFoundIds.length} IDs not found:</strong> ${data.notFoundIds.join(", ")}`
      );
    }

    elements.verifyResults.innerHTML = html;
    updateSubmitButton();
  } catch (err) {
    showVerifyResult("error", `Error: ${err.message}`);
  } finally {
    setButtonLoading(elements.verifyBtn, false, "Verify Users", getUsersIcon());
  }
}

function showVerifyResult(type, message) {
  elements.verifyResults.innerHTML = createAlert(type, message);
}

// --- TASK MANAGEMENT ---
function initTasks() {
  elements.addTaskBtn.addEventListener("click", addTask);
}

function createEmptyTask() {
  return {
    id: Date.now(),
    title: "",
    description: "",
    dueDate: "",
  };
}

function addTask() {
  if (tasks.length >= 20) return;
  tasks.push(createEmptyTask());
  renderTasks();
}

function removeTask(id) {
  if (tasks.length <= 1) return;
  tasks = tasks.filter((t) => t.id !== id);
  renderTasks();
}

function updateTask(id, field, value) {
  const task = tasks.find((t) => t.id === id);
  if (task) {
    task[field] = value;
  }
}

function renderTasks() {
  elements.tasksContainer.innerHTML = tasks
    .map(
      (task, index) => `
    <div class="task-card" data-id="${task.id}">
      <div class="task-card-inner">
        <div class="task-number">${index + 1}</div>
        <div class="task-fields">
          <input 
            type="text" 
            value="${escapeHtml(task.title)}" 
            placeholder="Task title *" 
            data-field="title"
          >
          <textarea 
            placeholder="Description (optional)" 
            data-field="description"
          >${escapeHtml(task.description)}</textarea>
          <div class="task-date-row">
            <svg class="icon" style="color: #9ca3af;" viewBox="0 0 24 24">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            <input 
              type="date" 
              value="${task.dueDate}" 
              data-field="dueDate"
            >
            <span class="optional">(optional)</span>
          </div>
        </div>
        <button class="btn btn-icon remove-task" ${tasks.length === 1 ? "disabled" : ""}>
          <svg class="icon" viewBox="0 0 24 24">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    </div>
  `
    )
    .join("");

  // Update count
  elements.taskCountNum.textContent = tasks.length;
  elements.addTaskBtn.disabled = tasks.length >= 20;

  // Attach event listeners
  elements.tasksContainer.querySelectorAll(".task-card").forEach((card) => {
    const id = parseInt(card.dataset.id);

    // Input handlers
    card.querySelectorAll("input, textarea").forEach((input) => {
      input.addEventListener("input", (e) => {
        updateTask(id, e.target.dataset.field, e.target.value);
      });
    });

    // Remove button handler
    const removeBtn = card.querySelector(".remove-task");
    if (removeBtn) {
      removeBtn.addEventListener("click", () => removeTask(id));
    }
  });
}

// --- FORM SUBMISSION ---
function initSubmit() {
  elements.titleInput.addEventListener("input", updateSubmitButton);
  elements.submitBtn.addEventListener("click", submitForm);
}

function updateSubmitButton() {
  const hasUsers = verifiedUsers.length > 0;
  const hasTitle = elements.titleInput.value.trim() !== "";
  elements.submitBtn.disabled = !(hasUsers && hasTitle);
}

async function submitForm() {
  const validTasks = tasks.filter((t) => t.title.trim() !== "");

  setButtonLoading(elements.submitBtn, true, "Creating...");

  try {
    const res = await fetch("/api/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        verifiedUsers,
        title: elements.titleInput.value.trim(),
        department: elements.departmentSelect.value || "Uncategorized",
        tasks: validTasks,
      }),
    });

    const data = await res.json();

    if (data.success) {
      alert(
        `✅ Success!\n\nChannel created: ${data.channelId}\nPost ID: ${data.postId}\nTasks distributed: ${data.taskCount}`
      );
      resetForm();
    } else {
      throw new Error(data.error || "Unknown error");
    }
  } catch (err) {
    alert(`❌ Error: ${err.message}`);
  } finally {
    setButtonLoading(elements.submitBtn, false, "Create Channel & Distribute Tasks", getSendIcon());
    updateSubmitButton();
  }
}

function resetForm() {
  elements.storeIdsInput.value = "";
  elements.titleInput.value = "";
  elements.departmentSelect.value = "";
  verifiedUsers = [];
  tasks = [createEmptyTask()];
  elements.verifyResults.innerHTML = "";
  renderTasks();
  updateSubmitButton();
}

// --- HISTORY ---
function initHistory() {
  elements.filterBtn.addEventListener("click", () => {
    loadHistory(elements.filterStoreId.value.trim());
  });

  elements.filterStoreId.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      loadHistory(elements.filterStoreId.value.trim());
    }
  });
}

async function loadHistory(storeId = "") {
  elements.historyContainer.innerHTML = `
    <div class="empty-state">
      <div class="spinner spinner-dark" style="margin: 0 auto;"></div>
      <p>Loading...</p>
    </div>
  `;

  try {
    const url = storeId ? `/api/items?storeId=${encodeURIComponent(storeId)}` : "/api/items";
    const res = await fetch(url);
    const data = await res.json();

    if (!data.items || data.items.length === 0) {
      elements.historyContainer.innerHTML = `
        <div class="empty-state">
          <svg class="icon-large" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
          <p>No submissions found</p>
          <p style="font-size: 13px;">Create your first announcement above</p>
        </div>
      `;
      return;
    }

    elements.historyContainer.innerHTML = data.items.map((item) => createHistoryItem(item)).join("");

    // Attach delete handlers
    elements.historyContainer.querySelectorAll(".delete-item").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (confirm("Are you sure you want to delete this channel?")) {
          try {
            await fetch(`/api/delete/${id}`, { method: "DELETE" });
            loadHistory(elements.filterStoreId.value.trim());
          } catch (err) {
            alert(`Error: ${err.message}`);
          }
        }
      });
    });
  } catch (err) {
    elements.historyContainer.innerHTML = createAlert("error", `Error loading history: ${err.message}`);
  }
}

function createHistoryItem(item) {
  const statusClass =
    item.status === "Published"
      ? "status-published"
      : item.status === "Scheduled"
      ? "status-scheduled"
      : "status-draft";

  const date = new Date(item.createdAt).toLocaleDateString();

  return `
    <div class="history-item" data-id="${item.channelId}">
      <div class="history-info">
        <h3>${escapeHtml(item.title)}</h3>
        <div class="history-meta">
          <span>
            <svg class="icon icon-small" viewBox="0 0 24 24">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
            ${escapeHtml(item.department)}
          </span>
          <span>
            <svg class="icon icon-small" viewBox="0 0 24 24">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
            </svg>
            ${item.userCount} users
          </span>
          <span>
            <svg class="icon icon-small" viewBox="0 0 24 24">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            ${date}
          </span>
        </div>
      </div>
      <div class="history-actions">
        <span class="status-badge ${statusClass}">${item.status}</span>
        <button class="btn btn-delete delete-item" data-id="${item.channelId}">
          <svg class="icon" viewBox="0 0 24 24">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    </div>
  `;
}

// --- UTILITY FUNCTIONS ---

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function createAlert(type, message) {
  const icons = {
    success: `<svg class="icon" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,
    warning: `<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
    error: `<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`,
  };

  return `<div class="alert alert-${type}">${icons[type]}${message}</div>`;
}

function setButtonLoading(btn, isLoading, text, icon = "") {
  if (isLoading) {
    btn.disabled = true;
    btn.innerHTML = `<div class="spinner"></div> ${text}`;
  } else {
    btn.disabled = false;
    btn.innerHTML = `${icon} ${text}`;
  }
}

function getUsersIcon() {
  return `<svg class="icon" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`;
}

function getSendIcon() {
  return `<svg class="icon" viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
}
