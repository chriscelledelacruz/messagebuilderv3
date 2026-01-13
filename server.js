const express = require("express");
const path = require("path");
require("dotenv").config();

const app = express();

// --- DISABLE ETAGS & CACHING ---
app.set("etag", false);
app.disable("view cache");

// Middleware
app.use(express.json({ limit: "50mb" }));

// --- ENV VARIABLES ---
const STAFFBASE_BASE_URL = process.env.STAFFBASE_BASE_URL;
const STAFFBASE_TOKEN = process.env.STAFFBASE_TOKEN;
const STAFFBASE_SPACE_ID = process.env.STAFFBASE_SPACE_ID;
const HIDDEN_ATTRIBUTE_KEY = process.env.HIDDEN_ATTRIBUTE_KEY;

// --- CONFIG: MANDATORY OPS IDs ---
const FIXED_OPS_IDS = (process.env.FIXED_OPS_IDS || "").split(",").filter(Boolean);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- API HELPER ---
async function sb(method, apiPath, body, customHeaders = {}) {
  const url = `${STAFFBASE_BASE_URL}${apiPath}`;
  const options = {
    method,
    headers: {
      Authorization: `Basic ${STAFFBASE_TOKEN}`,
      "Content-Type": "application/json",
      ...customHeaders,
    },
  };
  if (body) options.body = JSON.stringify(body);

  let retries = 3;
  while (retries > 0) {
    try {
      const res = await fetch(url, options);

      if (res.status === 429) {
        console.warn(`[API 429] Rate limit hit. Waiting 2s...`);
        await delay(2000);
        retries--;
        continue;
      }

      if (!res.ok) {
        const txt = await res.text();
        console.error(`[API Error] ${method} ${apiPath}: ${res.status} - ${txt}`);
        throw new Error(`API ${res.status}: ${txt}`);
      }

      if (res.status === 204) return {};
      return res.json();
    } catch (err) {
      if (retries <= 1) throw err;
      retries--;
      await delay(1000);
    }
  }
  throw new Error("API Timeout after retries");
}

// --- LOGIC HELPERS ---

async function getOpsGroupMembers() {
  const OPS_GROUP_ID = process.env.OPS_GROUP_ID;
  if (!OPS_GROUP_ID) return [];

  try {
    console.log(`[OPS] Fetching members for group: ${OPS_GROUP_ID}`);
    const filter = encodeURIComponent(`groups eq "${OPS_GROUP_ID}"`);
    const headers = { Accept: "application/vnd.staffbase.accessors.users-search.v1+json" };
    const res = await sb("GET", `/users/search?filter=${filter}`, null, headers);
    if (res.data) return res.data;
    return [];
  } catch (e) {
    console.warn("[OPS] Failed to fetch Ops members:", e.message);
    return [];
  }
}

// --- CACHED USER MAP ---
let cachedUserMap = null;
let userMapLastFetch = 0;
const USER_MAP_TTL = 1000 * 60 * 15; // Cache for 15 minutes

async function getAllUsersMap(forceRefresh = false) {
  if (!forceRefresh && cachedUserMap && Date.now() - userMapLastFetch < USER_MAP_TTL) {
    return cachedUserMap;
  }

  console.log("[CACHE] Refreshing User Map...");
  const userMap = new Map();
  let offset = 0;
  const limit = 100;

  while (true) {
    try {
      const res = await sb("GET", `/users?limit=${limit}&offset=${offset}`);
      if (!res.data || res.data.length === 0) break;

      for (const user of res.data) {
        const storeId = user.profile?.[HIDDEN_ATTRIBUTE_KEY];
        if (storeId) {
          userMap.set(String(storeId), {
            id: user.id,
            csvId: String(storeId),
            name: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
          });
        }
      }
      if (res.data.length < limit) break;
      offset += limit;
      if (offset % 1000 === 0) await delay(200);
    } catch (e) {
      console.error("[CACHE] Error fetching users:", e.message);
      break;
    }
  }

  cachedUserMap = userMap;
  userMapLastFetch = Date.now();
  console.log(`[CACHE] User Map loaded with ${userMap.size} entries`);
  return userMap;
}

async function discoverProjectsByStoreIds(storeIds) {
  const projectMap = {};
  let offset = 0;
  const limit = 100;

  while (true) {
    const res = await sb("GET", `/spaces/${STAFFBASE_SPACE_ID}/installations?limit=${limit}&offset=${offset}`);
    if (!res.data || res.data.length === 0) break;

    res.data.forEach((inst) => {
      const title = inst.config?.localization?.en_US?.title || "";
      const match = title.match(/^Store\s*#?\s*(\w+)$/i);
      if (match && storeIds.includes(match[1])) {
        projectMap[match[1]] = inst.id;
      }
    });

    if (res.data.length < limit) break;
    offset += limit;
  }

  console.log(`[PROJECTS] Found ${Object.keys(projectMap).length} matching projects for ${storeIds.length} store IDs`);
  return projectMap;
}

// --- ROUTES ---

// Health Check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// 1. VERIFY USERS
app.post("/api/verify-users", async (req, res) => {
  try {
    const { storeIds } = req.body;
    if (!storeIds || !Array.isArray(storeIds)) {
      return res.status(400).json({ error: "Invalid storeIds - expected array" });
    }

    const userMap = await getAllUsersMap();
    const foundUsers = [];
    const notFoundIds = [];

    for (const id of storeIds) {
      const user = userMap.get(String(id));
      if (user) foundUsers.push(user);
      else notFoundIds.push(id);
    }

    console.log(`[VERIFY] Found ${foundUsers.length}/${storeIds.length} users`);
    res.json({ foundUsers, notFoundIds });
  } catch (err) {
    console.error("[VERIFY] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 2. CREATE POST & TASKS
app.post("/api/create", async (req, res) => {
  try {
    let { verifiedUsers, title, department, tasks } = req.body;

    console.log("[CREATE] Payload:", {
      title,
      department,
      taskCount: tasks?.length || 0,
      userCount: verifiedUsers?.length || 0,
    });

    // Validate inputs
    if (!title || title.trim() === "") {
      return res.status(400).json({ error: "Title is required" });
    }

    if (!department || department === "undefined" || department.trim() === "") {
      department = "Uncategorized";
    }

    // Parse verifiedUsers if string
    if (typeof verifiedUsers === "string") {
      try {
        verifiedUsers = JSON.parse(verifiedUsers);
      } catch (e) {}
    }

    // Parse tasks if string
    if (typeof tasks === "string") {
      try {
        tasks = JSON.parse(tasks);
      } catch (e) {
        tasks = [];
      }
    }

    // Validate tasks (max 20)
    if (!Array.isArray(tasks)) tasks = [];
    tasks = tasks.slice(0, 20).filter((t) => t.title && t.title.trim() !== "");

    // Fallback: verify users if not already done
    if (!verifiedUsers || verifiedUsers.length === 0) {
      let { storeIds } = req.body;
      if (typeof storeIds === "string") {
        try {
          storeIds = JSON.parse(storeIds);
        } catch (e) {}
      }

      if (storeIds && storeIds.length > 0) {
        const userMap = await getAllUsersMap();
        verifiedUsers = [];
        for (const id of storeIds) {
          const u = userMap.get(String(id));
          if (u) verifiedUsers.push(u);
        }
      }
    }

    if (!verifiedUsers || verifiedUsers.length === 0) {
      return res.status(400).json({ error: "No verified users provided." });
    }

    const storeUserIds = verifiedUsers.map((u) => u.id);
    const storeIds = verifiedUsers.map((u) => u.csvId);

    // --- VISIBILITY: Combine Store Users + Ops Group + Fixed IDs ---
    const opsUsers = await getOpsGroupMembers();
    const opsUserIds = opsUsers.map((u) => u.id);

    const allAccessorIDs = [...new Set([...storeUserIds, ...opsUserIds, ...FIXED_OPS_IDS])];

    console.log(`[CREATE] Accessor Count: ${allAccessorIDs.length}`);

    const now = Date.now();

    // --- Generate Task HTML for Post Body ---
    let taskListHTML = "";
    if (tasks.length > 0) {
      taskListHTML = "<h3>Action Items</h3><ul>";
      tasks.forEach((t) => {
        let dateDisplay = "";
        if (t.dueDate) {
          const d = new Date(t.dueDate);
          dateDisplay = ` <span style="color:#666; font-size:0.9em;">(Due: ${d.toLocaleDateString()})</span>`;
        }
        const descText = t.description ? `<br><span style="color:#555;">${t.description}</span>` : "";
        taskListHTML += `<li><strong>${t.title}</strong>${descText}${dateDisplay}</li>`;
      });
      taskListHTML += "</ul>";
    }

    // --- Channel Naming ---
    const channelName = `${department} - ${new Date().toLocaleDateString()}`;

    // A. Create Channel
    console.log(`[CREATE] Creating channel: ${channelName}`);
    const channelRes = await sb("POST", `/spaces/${STAFFBASE_SPACE_ID}/installations`, {
      pluginID: "news",
      externalID: now.toString(),
      config: {
        localization: {
          en_US: { title: channelName },
          de_DE: { title: channelName },
        },
      },
      accessorIDs: allAccessorIDs,
    });

    const channelId = channelRes.id;
    console.log(`[CREATE] Channel created: ${channelId}`);

    // B. Create Post
    const contentHTML = `<h2>${title}</h2><hr>${taskListHTML}`;
    const contentTeaser = `Category: ${department}; Targeted Stores: ${storeUserIds.length}`;

    console.log(`[CREATE] Creating post in channel: ${channelId}`);
    const postRes = await sb("POST", `/channels/${channelId}/posts`, {
      contents: {
        en_US: {
          title: title,
          content: contentHTML,
          teaser: contentTeaser,
          kicker: department,
        },
      },
    });

    console.log(`[CREATE] Post created: ${postRes.id}`);

    // C. Distribute Tasks to Project Task Lists
    let taskCount = 0;
    let taskErrors = [];

    if (tasks.length > 0) {
      console.log(`[TASKS] Discovering projects for ${storeIds.length} stores...`);
      const projectMap = await discoverProjectsByStoreIds(storeIds);
      const installationIds = Object.values(projectMap);

      console.log(`[TASKS] Found ${installationIds.length} project installations`);

      if (installationIds.length > 0) {
        // Process in chunks of 5 to avoid rate limits
        const chunks = [];
        for (let i = 0; i < installationIds.length; i += 5) {
          chunks.push(installationIds.slice(i, i + 5));
        }

        for (const chunk of chunks) {
          await Promise.all(
            chunk.map(async (instId) => {
              try {
                // Create task list
                const listRes = await sb("POST", `/tasks/${instId}/lists`, { name: title });
                console.log(`[TASKS] Created task list ${listRes.id} in installation ${instId}`);

                // Create individual tasks
                for (const t of tasks) {
                  try {
                    await sb("POST", `/tasks/${instId}/tasks`, {
                      taskListId: listRes.id,
                      title: t.title,
                      description: t.description || "",
                      dueDate: t.dueDate ? new Date(t.dueDate).toISOString() : null,
                      status: "OPEN",
                      assigneeIds: [],
                    });
                    taskCount++;
                  } catch (taskErr) {
                    console.error(`[TASKS] Failed to create task "${t.title}":`, taskErr.message);
                    taskErrors.push({ task: t.title, error: taskErr.message });
                  }
                }
              } catch (e) {
                console.error(`[TASKS] Failed to create task list in ${instId}:`, e.message);
                taskErrors.push({ installation: instId, error: e.message });
              }
            })
          );

          // Small delay between chunks
          await delay(200);
        }
      } else {
        console.warn("[TASKS] No matching project installations found");
      }
    }

    res.json({
      success: true,
      channelId,
      postId: postRes.id,
      taskCount,
      taskErrors: taskErrors.length > 0 ? taskErrors : undefined,
    });
  } catch (err) {
    console.error("[CREATE] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 3. GET PAST SUBMISSIONS
app.get("/api/items", async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  try {
    const { storeId } = req.query;
    let targetUserId = null;

    if (storeId) {
      const userMap = await getAllUsersMap();
      const user = userMap.get(String(storeId));
      if (user) {
        targetUserId = user.id;
      } else {
        return res.json({ items: [] });
      }
    }

    const items = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const result = await sb("GET", `/spaces/${STAFFBASE_SPACE_ID}/installations?limit=${limit}&offset=${offset}`);
      if (!result.data || result.data.length === 0) break;

      for (const inst of result.data) {
        if (inst.pluginID !== "news") continue;

        if (targetUserId) {
          if (!inst.accessorIDs || !inst.accessorIDs.includes(targetUserId)) {
            continue;
          }
        }

        const channelTitle = inst.config?.localization?.en_US?.title || "Untitled";
        const defaultUserCount = inst.accessorIDs ? inst.accessorIDs.length : 0;
        const dateStr = inst.createdAt || inst.created || new Date().toISOString();

        let item = {
          channelId: inst.id,
          title: channelTitle,
          department: "Uncategorized",
          userCount: defaultUserCount,
          createdAt: dateStr,
          status: "Draft",
        };

        // Enrich with Post data
        try {
          const posts = await sb("GET", `/channels/${item.channelId}/posts?limit=1`);
          if (posts.data && posts.data.length > 0) {
            const p = posts.data[0];
            item.title = p.contents?.en_US?.title || item.title;

            const kickerText = p.contents?.en_US?.kicker || "";
            if (kickerText) item.department = kickerText.trim();

            if (p.published) item.status = "Published";
            else if (p.planned) item.status = "Scheduled";
          }
        } catch (e) {
          // Ignore post fetch errors
        }

        items.push(item);
      }

      if (result.data.length < limit) break;
      offset += limit;
    }

    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ items });
  } catch (err) {
    console.error("[LIST] Error:", err);
    res.json({ items: [] });
  }
});

// 4. DELETE
app.delete("/api/delete/:id", async (req, res) => {
  try {
    await sb("DELETE", `/installations/${req.params.id}`);
    console.log(`[DELETE] Deleted installation: ${req.params.id}`);
    res.json({ success: true });
  } catch (err) {
    console.error("[DELETE] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Catch-all for SPA
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
