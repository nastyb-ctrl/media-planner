const SUPABASE_URL = "https://vkvrwayzqrlsfsgjjwpy.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_-kj7hiC7uou3db2wpwFM_w_jgXQNpnb";

const sb = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

const $ = id => document.getElementById(id);

let user = null;
let project = null;
let members = [];
let tasks = [];
let currentDate = new Date();

function msg(el, text, ok = false) {
  if (!el) return;

  el.textContent = text;
  el.style.color = ok ? "#277443" : "#9a3030";
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function ruDate(s) {
  return new Date(
    s + "T12:00:00"
  ).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

/* =========================
   TELEGRAM + SUPABASE
========================= */

async function init() {
  const tg = window.Telegram?.WebApp;

  if (!tg) {
    showAuth(
      "Открой планер через Telegram."
    );
    return;
  }

  tg.ready();
  tg.expand();

  /*
    Supabase нужен только технически,
    чтобы текущие RLS-права базы продолжали работать.

    Пользователь при этом НЕ вводит:
    - email
    - пароль
    - код
    - логин
  */

  let {
    data: { session }
  } = await sb.auth.getSession();

  if (!session) {
    const {
      data,
      error
    } = await sb.auth.signInAnonymously();

    if (error) {
      showAuth(
        "Не удалось открыть планер: " +
        error.message
      );
      return;
    }

    session = data.session;
  }

  if (!session) {
    showAuth(
      "Не удалось создать техническую сессию."
    );
    return;
  }

  /*
    Telegram передаёт настоящего пользователя
    через Mini App initData.
  */

  if (!tg.initData) {
    showAuth(
      "Открой планер заново из Telegram."
    );
    return;
  }

  /*
    Edge Function проверяет Telegram
    и сохраняет Telegram ID в profiles.
  */

  const {
    data: authData,
    error: authError
  } = await sb.functions.invoke(
    "telegram-auth",
    {
      body: {
        initData: tg.initData
      }
    }
  );

  if (authError) {
    console.error(
      "telegram-auth error:",
      authError
    );

    showAuth(
      "Не удалось подтвердить Telegram."
    );
    return;
  }

  if (!authData?.ok) {
    console.error(
      "telegram-auth response:",
      authData
    );

    showAuth(
      authData?.error ||
      "Не удалось подтвердить Telegram."
    );
    return;
  }

  /*
    Всё.
    Пользователь считается вошедшим.
  */

  await startApp(
    session.user,
    authData.user
  );
}

function showAuth(text = "") {
  if ($("authView")) {
    $("authView").classList.remove(
      "hidden"
    );
  }

  if ($("appView")) {
    $("appView").classList.add(
      "hidden"
    );
  }

  if ($("authMessage")) {
    $("authMessage").textContent =
      text;
  }
}

async function startApp(
  u,
  tgUser
) {
  user = u;

  if ($("authView")) {
    $("authView").classList.add(
      "hidden"
    );
  }

  if ($("appView")) {
    $("appView").classList.remove(
      "hidden"
    );
  }

  if ($("userEmail")) {
    $("userEmail").textContent =
      tgUser?.username
        ? "@" + tgUser.username
        : tgUser?.first_name ||
          "Telegram";
  }

  if ($("userName")) {
    $("userName").textContent =
      tgUser?.first_name ||
      tgUser?.username ||
      "Участник";
  }

  await loadProject();

  subscribeRealtime();

  render();
}

/* =========================
   PROJECT
========================= */

async function loadProject() {
  const {
    data: mem
  } = await sb
    .from("project_members")
    .select(
      "project_id,role"
    )
    .eq(
      "user_id",
      user.id
    )
    .limit(1)
    .maybeSingle();

  if (mem) {
    const {
      data: p
    } = await sb
      .from("projects")
      .select("*")
      .eq(
        "id",
        mem.project_id
      )
      .single();

    project = p;
  } else {
    const {
      data,
      error
    } = await sb.rpc(
      "create_default_project",
      {
        project_name:
          "Media Planner"
      }
    );

    if (!error) {
      project = data;
    }
  }

  if (project) {
    await loadMembers();
    await loadTasks();
  } else {
    if ($("projectInfo")) {
      $("projectInfo").textContent =
        "Проект ещё не создан.";
    }
  }
}

async function loadMembers() {
  const {
    data
  } = await sb
    .from("project_members")
    .select(
      "user_id,role,profiles(id,name,email)"
    )
    .eq(
      "project_id",
      project.id
    );

  members =
    (data || []).map(x => ({
      id: x.user_id,
      role: x.role,
      ...(x.profiles || {})
    }));
}

async function loadTasks() {
  const {
    data,
    error
  } = await sb
    .from("tasks")
    .select("*")
    .eq(
      "project_id",
      project.id
    )
    .order(
      "date",
      {
        ascending: true
      }
    )
    .order(
      "time",
      {
        ascending: true
      }
    );

  if (!error) {
    tasks = data || [];
  }
}

/* =========================
   REALTIME
========================= */

function subscribeRealtime() {
  if (!project) return;

  sb.channel(
    "planner-" +
    project.id
  )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "tasks",
        filter:
          "project_id=eq." +
          project.id
      },
      async () => {
        await loadTasks();
        render();
      }
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table:
          "project_members",
        filter:
          "project_id=eq." +
          project.id
      },
      async () => {
        await loadMembers();
        renderTeam();
      }
    )
    .subscribe();
}

/* =========================
   RENDER
========================= */

function render() {
  renderCalendar();
  renderList();
  renderTeam();
}

function renderCalendar() {
  const y =
    currentDate.getFullYear();

  const m =
    currentDate.getMonth();

  $("monthTitle").textContent =
    new Date(
      y,
      m,
      1
    ).toLocaleDateString(
      "ru-RU",
      {
        month: "long",
        year: "numeric"
      }
    );

  const first =
    new Date(y, m, 1);

  const offset =
    (first.getDay() + 6) % 7;

  const days =
    new Date(
      y,
      m + 1,
      0
    ).getDate();

  const prevDays =
    new Date(
      y,
      m,
      0
    ).getDate();

  const cells = [];

  for (
    let i = 0;
    i < 42;
    i++
  ) {
    let dayNum =
      i - offset + 1;

    let d;
    let other = false;

    if (dayNum < 1) {
      d = new Date(
        y,
        m - 1,
        prevDays + dayNum
      );

      other = true;
    } else if (
      dayNum > days
    ) {
      d = new Date(
        y,
        m + 1,
        dayNum - days
      );

      other = true;
    } else {
      d = new Date(
        y,
        m,
        dayNum
      );
    }

    const date =
      isoDate(d);

    const isToday =
      date ===
      isoDate(
        new Date()
      );

    const dayTasks =
      tasks.filter(
        t =>
          t.date === date
      );

    cells.push(`
      <div
        class="day ${
          other
            ? "other"
            : ""
        } ${
          isToday
            ? "today"
            : ""
        }"
        data-date="${date}"
      >

        <div class="day-num">
          ${d.getDate()}
        </div>

        ${dayTasks
          .map(
            t => `
              <div
                class="task-chip ${
                  t.status ===
                  "done"
                    ? "done"
                    : ""
                }"
                data-task="${t.id}"
              >
                <span class="dot"></span>
                ${escapeHtml(
                  t.title
                )}
              </div>
            `
          )
          .join("")}

      </div>
    `);
  }

  $("calendarGrid").innerHTML =
    cells.join("");

  document
    .querySelectorAll(
      ".day"
    )
    .forEach(el => {
      el.addEventListener(
        "dblclick",
        () =>
          openModal(
            null,
            el.dataset.date
          )
      );
    });

  document
    .querySelectorAll(
      ".task-chip"
    )
    .forEach(el => {
      el.addEventListener(
        "click",
        e => {
          e.stopPropagation();

          openModal(
            el.dataset.task
          );
        }
      );
    });
}

function renderList() {
  const q =
    (
      $("searchInput")
        ?.value || ""
    ).toLowerCase();

  const s =
    $("statusFilter")
      ?.value || "";

  const list =
    tasks.filter(
      t =>
        (
          !q ||
          [
            t.title,
            t.description,
            t.platform,
            t.type
          ]
            .join(" ")
            .toLowerCase()
            .includes(q)
        ) &&
        (
          !s ||
          t.status === s
        )
    );

  $("taskList").innerHTML =
    list
      .map(
        t => `
          <div class="task-row">

            <div class="task-date">
              ${ruDate(t.date)}
              ${
                t.time
                  ? " · " +
                    t.time
                  : ""
              }
            </div>

            <div>
              <h3>
                ${escapeHtml(
                  t.title
                )}
              </h3>

              <div class="muted">
                ${escapeHtml(
                  t.platform
                )}
                ·
                ${escapeHtml(
                  t.type
                )}
                ${
                  t.owner_id
                    ? " · " +
                      escapeHtml(
                        memberName(
                          t.owner_id
                        )
                      )
                    : ""
                }
              </div>
            </div>

            <span class="pill">
              ${statusName(
                t.status
              )}
            </span>

          </div>
        `
      )
      .join("") ||
    `
      <div class="team-card">
        Пока ничего нет.
      </div>
    `;

  document
    .querySelectorAll(
      ".task-row"
    )
    .forEach(
      (el, i) => {
        el.addEventListener(
          "click",
          () =>
            openModal(
              list[i].id
            )
        );
      }
    );
}

function renderTeam() {
  if (!project) return;

  $("teamList").innerHTML =
    members
      .map(
        m => `
          <div class="team-member">

            <span>
              ${escapeHtml(
                m.name ||
                m.email ||
                "Участник"
              )}
            </span>

            <span class="pill">
              ${m.role}
            </span>

          </div>
        `
      )
      .join("");

  $("projectInfo").textContent =
    `Код проекта: ${
      project.invite_code ||
      project.id
    }`;
}

function memberName(id) {
  const m =
    members.find(
      x => x.id === id
    );

  return (
    m?.name ||
    m?.email ||
    ""
  );
}

function statusName(s) {
  return {
    planned:
      "Запланировано",
    progress:
      "В работе",
    done:
      "Готово"
  }[s] || s;
}

function escapeHtml(s) {
  return String(
    s ?? ""
  ).replace(
    /[&<>"']/g,
    c =>
      ({
        "&":
          "&amp;",
        "<":
          "&lt;",
        ">":
          "&gt;",
        '"':
          "&quot;",
        "'":
          "&#039;"
      }[c])
  );
}

/* =========================
   VIEWS
========================= */

function switchView(
  view
) {
  document
    .querySelectorAll(
      ".view"
    )
    .forEach(x =>
      x.classList.add(
        "hidden"
      )
    );

  $(
    view + "View"
  ).classList.remove(
    "hidden"
  );

  document
    .querySelectorAll(
      ".nav[data-view]"
    )
    .forEach(x =>
      x.classList.toggle(
        "active",
        x.dataset.view ===
          view
      )
    );

  $("pageTitle").textContent =
    {
      calendar:
        "Календарь",
      list:
        "Все задачи",
      team:
        "Команда"
    }[view];
}

/* =========================
   MODAL
========================= */

function openModal(
  taskId = null,
  date = null
) {
  $("taskModal")
    .classList.remove(
      "hidden"
    );

  $("modalMessage").textContent =
    "";

  $("taskId").value =
    taskId || "";

  const t =
    tasks.find(
      x =>
        x.id === taskId
    );

  $("modalTitle").textContent =
    t
      ? "Редактировать контент"
      : "Новый контент";

  $("deleteTaskBtn")
    .classList.toggle(
      "hidden",
      !t
    );

  $("taskTitle").value =
    t?.title || "";

  $("taskDate").value =
    t?.date ||
    date ||
    isoDate(
      currentDate
    );

  $("taskTime").value =
    t?.time || "";

  $("taskPlatform").value =
    t?.platform ||
    "Instagram";

  $("taskType").value =
    t?.type ||
    "Reels";

  $("taskOwner").innerHTML =
    `
      <option value="">
        Не назначен
      </option>
    ` +
    members
      .map(
        m => `
          <option value="${m.id}">
            ${escapeHtml(
              m.name ||
              m.email ||
              "Участник"
            )}
          </option>
        `
      )
      .join("");

  $("taskOwner").value =
    t?.owner_id || "";

  $("taskStatus").value =
    t?.status ||
    "planned";

  $("taskDescription").value =
    t?.description ||
    "";

  $("taskLink").value =
    t?.link || "";

  $("rem24").checked =
    t?.reminder_24h ??
    true;

  $("rem3").checked =
    t?.reminder_3h ??
    false;

  $("rem1").checked =
    t?.reminder_1h ??
    false;
}

function closeModal() {
  $("taskModal")
    .classList.add(
      "hidden"
    );
}

/* =========================
   TASKS
========================= */

async function saveTask() {
  if (!project) return;

  const title =
    $("taskTitle")
      .value
      .trim();

  const date =
    $("taskDate").value;

  if (!title || !date) {
    msg(
      $("modalMessage"),
      "Заполни название и дату."
    );
    return;
  }

  const payload = {
    project_id:
      project.id,

    title,

    description:
      $("taskDescription")
        .value,

    date,

    time:
      $("taskTime")
        .value ||
      null,

    platform:
      $("taskPlatform")
        .value,

    type:
      $("taskType")
        .value,

    owner_id:
      $("taskOwner")
        .value ||
      null,

    status:
      $("taskStatus")
        .value,

    link:
      $("taskLink")
        .value ||
      null,

    reminder_24h:
      $("rem24")
        .checked,

    reminder_3h:
      $("rem3")
        .checked,

    reminder_1h:
      $("rem1")
        .checked,

    created_by:
      user.id,

    updated_at:
      new Date()
        .toISOString()
  };

  const id =
    $("taskId").value;

  const {
    error
  } = id
    ? await sb
        .from("tasks")
        .update(
          payload
        )
        .eq(
          "id",
          id
        )
    : await sb
        .from("tasks")
        .insert(
          payload
        );

  if (error) {
    msg(
      $("modalMessage"),
      error.message
    );
    return;
  }

  closeModal();

  await loadTasks();

  render();
}

async function deleteTask() {
  const id =
    $("taskId").value;

  if (!id) return;

  if (
    !confirm(
      "Удалить этот контент?"
    )
  ) {
    return;
  }

  const {
    error
  } = await sb
    .from("tasks")
    .delete()
    .eq(
      "id",
      id
    );

  if (error) {
    msg(
      $("modalMessage"),
      error.message
    );
    return;
  }

  closeModal();

  await loadTasks();

  render();
}

/* =========================
   PROJECT JOIN
========================= */

async function joinProject() {
  const code =
    $("projectCodeInput")
      .value
      .trim();

  if (!code) return;

  const {
    data,
    error
  } = await sb.rpc(
    "join_project",
    {
      project_uuid:
        code
    }
  );

  if (error) {
    msg(
      $("projectInfo"),
      error.message
    );
    return;
  }

  project = data;

  await loadMembers();
  await loadTasks();

  subscribeRealtime();

  render();

  msg(
    $("projectInfo"),
    "Ты присоединилась к проекту.",
    true
  );
}

/* =========================
   BUTTONS
========================= */

if ($("logoutBtn")) {
  $("logoutBtn").onclick =
    async () => {
      /*
        Выход пользователю не нужен,
        поэтому просто перезагружаем приложение.
      */

      location.reload();
    };
}

$("addTaskBtn").onclick =
  () => openModal();

$("closeModal").onclick =
  closeModal;

$("cancelTaskBtn").onclick =
  closeModal;

$("saveTaskBtn").onclick =
  saveTask;

$("deleteTaskBtn").onclick =
  deleteTask;

$("prevMonth").onclick =
  () => {
    currentDate.setMonth(
      currentDate.getMonth() - 1
    );

    renderCalendar();
  };

$("nextMonth").onclick =
  () => {
    currentDate.setMonth(
      currentDate.getMonth() + 1
    );

    renderCalendar();
  };

$("todayBtn").onclick =
  () => {
    currentDate =
      new Date();

    renderCalendar();
  };

$("searchInput").oninput =
  renderList;

$("statusFilter").onchange =
  renderList;

$("joinProjectBtn").onclick =
  joinProject;

document
  .querySelectorAll(
    ".nav[data-view]"
  )
  .forEach(x => {
    x.onclick = () =>
      switchView(
        x.dataset.view
      );
  });

$("notifyBtn").onclick =
  async () => {
    if (
      !(
        "Notification"
        in window
      )
    ) {
      alert(
        "Браузер не поддерживает уведомления."
      );
      return;
    }

    const p =
      await Notification
        .requestPermission();

    if (
      p === "granted"
    ) {
      new Notification(
        "Media Planner",
        {
          body:
            "Уведомления включены."
        }
      );
    }
  };

/* =========================
   START
========================= */

init();
