const SUPABASE_URL = "https://vkvrwayzqrlsfsgjjwpy.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_-kj7hiC7uou3db2wpwFM_w_jgXQNpnb";

const sb = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

const $ = id => document.getElementById(id);

let user = null;
let telegramUser = null;
let project = null;
let members = [];
let contentItems = [];
let publications = [];
let currentDate = new Date();
let editingContentId = null;


/* =====================================================
   HELPERS
===================================================== */

function msg(el, text, ok = false) {
  if (!el) return;

  el.textContent = text;
  el.style.color = ok ? "#277443" : "#9a3030";
}

function isoDate(d) {
  const local = new Date(d);

  const year = local.getFullYear();
  const month = String(
    local.getMonth() + 1
  ).padStart(2, "0");

  const day = String(
    local.getDate()
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function ruDate(s) {
  if (!s) return "";

  return new Date(
    s + "T12:00:00"
  ).toLocaleDateString(
    "ru-RU",
    {
      day: "2-digit",
      month: "long"
    }
  );
}

function formatTime(time) {
  if (!time) return "";

  return String(time)
    .slice(0, 5);
}

function escapeHtml(s) {
  return String(
    s ?? ""
  ).replace(
    /[&<>"']/g,
    c =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[c])
  );
}

function platformName(platform) {
  return {
    Telegram: "Telegram",
    Instagram: "Instagram",
    TikTok: "TikTok",
    VK: "VK",
    YouTube: "YouTube"
  }[platform] || platform;
}

function formatName(format) {
  return format || "Публикация";
}

function statusName(status) {
  return {
    planned: "Запланировано",
    progress: "В работе",
    done: "Готово"
  }[status] || status;
}


/* =====================================================
   TELEGRAM AUTH
===================================================== */

async function init() {
  const tg =
    window.Telegram?.WebApp;

  if (!tg) {
    showAuth(
      "Открой планер через Telegram."
    );
    return;
  }

  tg.ready();
  tg.expand();

  let {
    data: {
      session
    }
  } = await sb.auth.getSession();

  /*
    Anonymous Supabase session —
    только технический доступ к базе.

    Пользователь ничего не вводит.
  */

  if (!session) {
    const {
      data,
      error
    } =
      await sb.auth.signInAnonymously();

    if (error) {
      console.error(error);

      showAuth(
        "Не удалось открыть планер."
      );

      return;
    }

    session =
      data.session;
  }

  if (!session) {
    showAuth(
      "Не удалось создать сессию."
    );

    return;
  }

  if (!tg.initData) {
    showAuth(
      "Открой планер заново из Telegram."
    );

    return;
  }

  const {
    data: authData,
    error: authError
  } =
    await sb.functions.invoke(
      "telegram-auth",
      {
        body: {
          initData:
            tg.initData
        }
      }
    );

  if (authError) {
    console.error(
      "Telegram auth:",
      authError
    );

    showAuth(
      "Не удалось подтвердить Telegram."
    );

    return;
  }

  if (
    !authData?.ok
  ) {
    console.error(
      authData
    );

    showAuth(
      authData?.error ||
      "Не удалось подтвердить Telegram."
    );

    return;
  }

  telegramUser =
    authData.user;

  await startApp(
    session.user
  );
}

function showAuth(text = "") {
  if ($("authView")) {
    $("authView")
      .classList
      .remove("hidden");
  }

  if ($("appView")) {
    $("appView")
      .classList
      .add("hidden");
  }

  if ($("authMessage")) {
    $("authMessage")
      .textContent = text;
  }
}


/* =====================================================
   START APP
===================================================== */

async function startApp(
  supabaseUser
) {
  user =
    supabaseUser;

  $("authView")
    ?.classList
    .add("hidden");

  $("appView")
    ?.classList
    .remove("hidden");

  if ($("userEmail")) {
    $("userEmail")
      .textContent =
      telegramUser?.username
        ? "@" +
          telegramUser.username
        : "Telegram";
  }

  if ($("userName")) {
    $("userName")
      .textContent =
      telegramUser?.first_name ||
      "Участник";
  }

  await loadProject();

  await loadMembers();

  await loadContent();

  subscribeRealtime();

  render();

  renderAnalytics();
}


/* =====================================================
   PROJECT
===================================================== */

async function loadProject() {
  const {
    data: mem
  } =
    await sb
      .from(
        "project_members"
      )
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
      data: p,
      error
    } =
      await sb
        .from("projects")
        .select("*")
        .eq(
          "id",
          mem.project_id
        )
        .single();

    if (!error) {
      project = p;
    }

  } else {

    const {
      data,
      error
    } =
      await sb.rpc(
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

  if (!project) {
    $("projectInfo")
      && (
        $("projectInfo")
          .textContent =
          "Проект ещё не создан."
      );
  }
}


/* =====================================================
   TEAM
===================================================== */

async function loadMembers() {

  if (!project) return;

  const {
    data,
    error
  } =
    await sb
      .from(
        "project_members"
      )
      .select(
        "user_id,role,profiles(id,name,email,telegram_id,telegram_username,telegram_first_name,telegram_photo_url)"
      )
      .eq(
        "project_id",
        project.id
      );

  if (error) {
    console.error(
      "Members:",
      error
    );

    members = [];
    return;
  }

  members =
    (data || [])
      .map(x => ({
        id: x.user_id,
        role: x.role,
        ...(x.profiles || {})
      }));
}


/* =====================================================
   CONTENT + PUBLICATIONS
===================================================== */

async function loadContent() {

  if (!project) return;

  const {
    data: contents,
    error:
      contentError
  } =
    await sb
      .from("content")
      .select("*")
      .eq(
        "project_id",
        project.id
      )
      .order(
        "created_at",
        {
          ascending: false
        }
      );

  if (contentError) {
    console.error(
      "Content:",
      contentError
    );

    contentItems = [];
    publications = [];

    return;
  }

  contentItems =
    contents || [];

  const {
    data: pubs,
    error:
      publicationError
  } =
    await sb
      .from("publications")
      .select("*")
      .eq(
        "project_id",
        project.id
      )
      .order(
        "publication_date",
        {
          ascending: true
        }
      )
      .order(
        "publication_time",
        {
          ascending: true
        }
      );

  if (publicationError) {
    console.error(
      "Publications:",
      publicationError
    );

    publications = [];

    return;
  }

  publications =
    pubs || [];

  /*
    Загружаем ответственных
    для всех публикаций.
  */

  if (
    publications.length
  ) {

    const ids =
      publications.map(
        p => p.id
      );

    const {
      data: assignees
    } =
      await sb
        .from(
          "publication_assignees"
        )
        .select(
          "publication_id,user_id"
        )
        .in(
          "publication_id",
          ids
        );

    publications =
      publications.map(
        p => ({
          ...p,
          assigneeIds:
            (assignees || [])
              .filter(
                a =>
                  a.publication_id ===
                  p.id
              )
              .map(
                a =>
                  a.user_id
              )
        })
      );
  }
}


/* =====================================================
   REALTIME
===================================================== */

function subscribeRealtime() {

  if (!project) return;

  sb.channel(
    "media-planner-" +
    project.id
  )

    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "content",
        filter:
          "project_id=eq." +
          project.id
      },
      async () => {

        await loadContent();

        render();
        renderAnalytics();
      }
    )

    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "publications",
        filter:
          "project_id=eq." +
          project.id
      },
      async () => {

        await loadContent();

        render();
        renderAnalytics();
      }
    )

    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table:
          "publication_assignees"
      },
      async () => {

        await loadContent();

        render();
        renderAnalytics();
      }
    )

    .subscribe();
}


/* =====================================================
   MAIN RENDER
===================================================== */

function render() {

  renderCalendar();

  renderList();

  renderTeam();

  renderAnalytics();
}


/* =====================================================
   CALENDAR
===================================================== */

function renderCalendar() {

  const y =
    currentDate.getFullYear();

  const m =
    currentDate.getMonth();

  $("monthTitle")
    .textContent =
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
    new Date(
      y,
      m,
      1
    );

  const offset =
    (first.getDay() + 6) %
    7;

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
      i -
      offset +
      1;

    let d;
    let other =
      false;

    if (dayNum < 1) {

      d =
        new Date(
          y,
          m - 1,
          prevDays +
            dayNum
        );

      other = true;

    } else if (
      dayNum > days
    ) {

      d =
        new Date(
          y,
          m + 1,
          dayNum -
            days
        );

      other = true;

    } else {

      d =
        new Date(
          y,
          m,
          dayNum
        );
    }

    const date =
      isoDate(d);

    const today =
      date ===
      isoDate(
        new Date()
      );

    const dayPubs =
      publications
        .filter(
          p =>
            p.publication_date ===
            date
        )
        .sort(
          (a, b) =>
            String(
              a.publication_time ||
              ""
            ).localeCompare(
              String(
                b.publication_time ||
                ""
              )
            )
        );

    cells.push(`
      <div
        class="day ${
          other
            ? "other"
            : ""
        } ${
          today
            ? "today"
            : ""
        }"
        data-date="${date}"
      >

        <div class="day-num">
          ${d.getDate()}
        </div>

        <div class="day-publications">

          ${dayPubs
            .slice(0, 4)
            .map(
              p => `
                <div
                  class="task-chip ${
                    p.status ===
                    "done"
                      ? "done"
                      : ""
                  }"
                  data-publication="${p.id}"
                >

                  <span class="dot"></span>

                  <span>
                    ${
                      p.publication_time
                        ? formatTime(
                            p.publication_time
                          ) +
                          " "
                        : ""
                    }

                    ${escapeHtml(
                      platformName(
                        p.platform
                      )
                    )}
                  </span>

                  <span class="calendar-title">
                    ${escapeHtml(
                      p.title
                    )}
                  </span>

                </div>
              `
            )
            .join("")}

          ${
            dayPubs.length > 4
              ? `
                <div class="more-publications">
                  +${dayPubs.length - 4}
                </div>
              `
              : ""
          }

        </div>

      </div>
    `);
  }

  $("calendarGrid")
    .innerHTML =
    cells.join("");

  document
    .querySelectorAll(
      ".day"
    )
    .forEach(
      el => {

        el.addEventListener(
          "dblclick",
          () =>
            openModal(
              null,
              el.dataset.date
            )
        );
      }
    );

  document
    .querySelectorAll(
      "[data-publication]"
    )
    .forEach(
      el => {

        el.addEventListener(
          "click",
          e => {

            e.stopPropagation();

            const id =
              el.dataset
                .publication;

            openPublication(
              id
            );
          }
        );
      }
    );
}


/* =====================================================
   CONTENT LIST
===================================================== */

function renderList() {

  const q =
    (
      $("searchInput")
        ?.value ||
      ""
    )
      .toLowerCase()
      .trim();

  const status =
    $("statusFilter")
      ?.value ||
    "";

  const platform =
    $("platformFilter")
      ?.value ||
    "";

  const filtered =
    publications
      .filter(
        p => {

          const content =
            contentItems.find(
              c =>
                c.id ===
                p.content_id
            );

          const text =
            [
              p.title,
              p.description,
              p.platform,
              p.format,
              content?.title,
              content?.description
            ]
              .join(" ")
              .toLowerCase();

          return (
            (!q ||
              text.includes(q)) &&
            (!status ||
              p.status ===
                status) &&
            (!platform ||
              p.platform ===
                platform)
          );
        }
      );

  const grouped = {};

  filtered.forEach(
    p => {

      if (
        !grouped[
          p.publication_date
        ]
      ) {
        grouped[
          p.publication_date
        ] = [];
      }

      grouped[
        p.publication_date
      ].push(p);
    }
  );

  const dates =
    Object.keys(
      grouped
    ).sort();

  if (!dates.length) {

    $("taskList")
      .innerHTML = `
        <div class="team-card">
          Пока ничего нет.
        </div>
      `;

    return;
  }

  $("taskList")
    .innerHTML =
    dates
      .map(
        date => `

          <div class="content-day-group">

            <h3>
              ${ruDate(date)}
            </h3>

            ${grouped[date]
              .sort(
                (a, b) =>
                  String(
                    a.publication_time ||
                    ""
                  ).localeCompare(
                    String(
                      b.publication_time ||
                      ""
                    )
                  )
              )
              .map(
                p => {

                  const content =
                    contentItems.find(
                      c =>
                        c.id ===
                        p.content_id
                    );

                  return `
                    <div
                      class="task-row"
                      data-publication="${p.id}"
                    >

                      <div class="task-date">

                        ${
                          p.publication_time
                            ? formatTime(
                                p.publication_time
                              )
                            : "—"
                        }

                      </div>

                      <div>

                        <h3>
                          ${escapeHtml(
                            p.title
                          )}
                        </h3>

                        <div class="muted">

                          ${escapeHtml(
                            platformName(
                              p.platform
                            )
                          )}

                          ·

                          ${escapeHtml(
                            formatName(
                              p.format
                            )
                          )}

                          ${
                            content
                              ? `
                                · ${escapeHtml(
                                  content.title
                                )}
                              `
                              : ""
                          }

                        </div>

                      </div>

                      <span class="pill">
                        ${statusName(
                          p.status
                        )}
                      </span>

                    </div>
                  `;
                }
              )
              .join("")}

          </div>

        `
      )
      .join("");

  document
    .querySelectorAll(
      "#taskList [data-publication]"
    )
    .forEach(
      el => {

        el.addEventListener(
          "click",
          () =>
            openPublication(
              el.dataset
                .publication
            )
        );
      }
    );
}


/* =====================================================
   TEAM
===================================================== */

function renderTeam() {

  const list =
    members || [];

  if ($("teamCount")) {
    $("teamCount")
      .textContent =
      list.length;
  }

  if (!$("teamList"))
    return;

  if (!list.length) {

    $("teamList")
      .innerHTML = `
        <div class="team-card">
          Пока никто не использует планер.
        </div>
      `;

    return;
  }

  $("teamList")
    .innerHTML =
    list
      .map(
        m => {

          const name =
            m.telegram_first_name ||
            m.name ||
            m.email ||
            "Участник";

          const username =
            m.telegram_username
              ? "@" +
                m.telegram_username
              : "";

          return `
            <div class="team-member">

              <div class="team-person">

                ${
                  m.telegram_photo_url
                    ? `
                      <img
                        class="team-avatar"
                        src="${escapeHtml(
                          m.telegram_photo_url
                        )}"
                        alt=""
                      />
                    `
                    : `
                      <div class="team-avatar team-avatar-placeholder">
                        ${escapeHtml(
                          name
                            .charAt(0)
                            .toUpperCase()
                        )}
                      </div>
                    `
                }

                <div>

                  <strong>
                    ${escapeHtml(
                      name
                    )}
                  </strong>

                  ${
                    username
                      ? `
                        <div class="muted">
                          ${escapeHtml(
                            username
                          )}
                        </div>
                      `
                      : ""
                  }

                </div>

              </div>

              <span class="pill">
                ${escapeHtml(
                  m.role ||
                  "Участник"
                )}
              </span>

            </div>
          `;
        }
      )
      .join("");
}


/* =====================================================
   ANALYTICS
===================================================== */

function getAnalyticsPublications() {

  const period =
    $("analyticsPeriod")
      ?.value ||
    "month";

  const platform =
    $("analyticsPlatform")
      ?.value ||
    "";

  let list =
    publications.slice();

  if (platform) {
    list =
      list.filter(
        p =>
          p.platform ===
          platform
      );
  }

  const now =
    new Date();

  const today =
    isoDate(now);

  if (period === "week") {

    const start =
      new Date(now);

    const day =
      (start.getDay() + 6) %
      7;

    start.setDate(
      start.getDate() -
      day
    );

    const startDate =
      isoDate(start);

    list =
      list.filter(
        p =>
          p.publication_date >=
          startDate &&
          p.publication_date <=
          today
      );
  }

  if (period === "month") {

    const start =
      new Date(
        now.getFullYear(),
        now.getMonth(),
        1
      );

    const end =
      new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0
      );

    list =
      list.filter(
        p =>
          p.publication_date >=
          isoDate(start) &&
          p.publication_date <=
          isoDate(end)
      );
  }

  if (
    period ===
    "3months"
  ) {

    const start =
      new Date(now);

    start.setMonth(
      start.getMonth() - 2
    );

    start.setDate(1);

    list =
      list.filter(
        p =>
          p.publication_date >=
          isoDate(start) &&
          p.publication_date <=
          today
      );
  }

  return list;
}

function renderAnalytics() {

  const list =
    getAnalyticsPublications();

  const total =
    list.length;

  if ($("analyticsTotal")) {
    $("analyticsTotal")
      .textContent =
      total;
  }

  /*
    Для простоты считаем
    среднюю частоту по 7 дням.
  */

  let days = 30;

  const period =
    $("analyticsPeriod")
      ?.value ||
    "month";

  if (period === "week")
    days = 7;

  if (
    period === "3months"
  )
    days = 90;

  if (period === "all") {

    if (list.length) {

      const dates =
        list.map(
          p =>
            new Date(
              p.publication_date
            )
        );

      const min =
        Math.min(
          ...dates.map(
            d =>
              d.getTime()
          )
        );

      const max =
        Math.max(
          ...dates.map(
            d =>
              d.getTime()
          )
        );

      days =
        Math.max(
          1,
          Math.round(
            (
              max - min
            ) /
            86400000
          ) + 1
        );
    } else {
      days = 1;
    }
  }

  const weeks =
    Math.max(
      1,
      days / 7
    );

  if ($("analyticsPerWeek")) {
    $("analyticsPerWeek")
      .textContent =
      (
        total /
        weeks
      ).toFixed(1);
  }

  if ($("analyticsPerDay")) {
    $("analyticsPerDay")
      .textContent =
      (
        total /
        days
      ).toFixed(1);
  }

  renderAnalyticsBars(
    "platformAnalytics",
    countBy(
      list,
      p => p.platform
    )
  );

  renderAnalyticsBars(
    "formatAnalytics",
    countBy(
      list,
      p => p.format
    )
  );

  renderFrequency(
    list
  );

  renderWeekdays(
    list
  );

  renderAssignees(
    list
  );
}

function countBy(
  list,
  getter
) {

  const result = {};

  list.forEach(
    item => {

      const key =
        getter(item) ||
        "Другое";

      result[key] =
        (result[key] ||
          0) + 1;
    }
  );

  return result;
}

function renderAnalyticsBars(
  id,
  data
) {

  const el =
    $(id);

  if (!el) return;

  const entries =
    Object.entries(
      data
    ).sort(
      (a, b) =>
        b[1] - a[1]
    );

  const total =
    entries.reduce(
      (sum, x) =>
        sum + x[1],
      0
    );

  if (!entries.length) {

    el.innerHTML =
      `<div class="muted">
        Нет данных
      </div>`;

    return;
  }

  el.innerHTML =
    entries
      .map(
        ([name, count]) => {

          const percent =
            total
              ? Math.round(
                  count /
                  total *
                  100
                )
              : 0;

          return `
            <div class="analytics-bar-row">

              <div class="analytics-bar-top">

                <span>
                  ${escapeHtml(
                    name
                  )}
                </span>

                <strong>
                  ${percent}%
                </strong>

              </div>

              <div class="analytics-bar-track">

                <div
                  class="analytics-bar-fill"
                  style="width:${percent}%"
                ></div>

              </div>

            </div>
          `;
        }
      )
      .join("");
}

function renderFrequency(
  list
) {

  const el =
    $("frequencyAnalytics");

  if (!el) return;

  const data =
    countBy(
      list,
      p => p.platform
    );

  const total =
    list.length;

  if (!total) {

    el.innerHTML =
      `<div class="muted">
        Нет данных
      </div>`;

    return;
  }

  const period =
    $("analyticsPeriod")
      ?.value ||
    "month";

  let days = 30;

  if (period === "week")
    days = 7;

  if (
    period ===
    "3months"
  )
    days = 90;

  const weeks =
    Math.max(
      1,
      days / 7
    );

  el.innerHTML = `
    <table>

      <thead>

        <tr>
          <th>Соцсеть</th>
          <th>Публикаций</th>
          <th>В неделю</th>
        </tr>

      </thead>

      <tbody>

        ${Object.entries(
          data
        )
          .sort(
            (a, b) =>
              b[1] -
              a[1]
          )
          .map(
            ([name, count]) => `
              <tr>

                <td>
                  ${escapeHtml(
                    name
                  )}
                </td>

                <td>
                  ${count}
                </td>

                <td>
                  ${(
                    count /
                    weeks
                  ).toFixed(1)}
                </td>

              </tr>
            `
          )
          .join("")}

      </tbody>

    </table>
  `;
}

function renderWeekdays(
  list
) {

  const names = [
    "Пн",
    "Вт",
    "Ср",
    "Чт",
    "Пт",
    "Сб",
    "Вс"
  ];

  const data = {};

  names.forEach(
    x => {
      data[x] = 0;
    }
  );

  list.forEach(
    p => {

      const d =
        new Date(
          p.publication_date +
          "T12:00:00"
        );

      const index =
        (
          d.getDay() +
          6
        ) % 7;

      data[
        names[index]
      ]++;
    }
  );

  renderAnalyticsBars(
    "weekdayAnalytics",
    data
  );
}

function renderAssignees(
  list
) {

  const counts = {};

  list.forEach(
    p => {

      (
        p.assigneeIds ||
        []
      ).forEach(
        id => {

          counts[id] =
            (
              counts[id] ||
              0
            ) + 1;
        }
      );
    }
  );

  const named = {};

  Object.entries(
    counts
  ).forEach(
    ([id, count]) => {

      const member =
        members.find(
          m =>
            m.id === id
        );

      const name =
        member?.telegram_first_name ||
        member?.name ||
        member?.email ||
        "Участник";

      named[name] =
        count;
    }
  );

  renderAnalyticsBars(
    "assigneeAnalytics",
    named
  );
}


/* =====================================================
   MODAL — NEW / EDIT CONTENT
===================================================== */

function openModal(
  contentId = null,
  date = null
) {

  editingContentId =
    contentId;

  $("taskModal")
    .classList
    .remove("hidden");

  $("modalMessage")
    .textContent = "";

  const content =
    contentItems.find(
      c =>
        c.id ===
        contentId
    );

  $("modalTitle")
    .textContent =
    content
      ? "Редактировать контент"
      : "Новый контент";

  $("contentTitle")
    .value =
    content?.title ||
    "";

  $("contentDescription")
    .value =
    content?.description ||
    "";

  $("publicationsList")
    .innerHTML = "";

  const pubs =
    contentId
      ? publications
          .filter(
            p =>
              p.content_id ===
              contentId
          )
          .sort(
            (a, b) =>
              String(
                a.publication_time ||
                ""
              ).localeCompare(
                String(
                  b.publication_time ||
                  ""
                )
              )
          )
      : [];

  if (pubs.length) {

    pubs.forEach(
      p =>
        addPublicationEditor(
          p
        )
    );

  } else {

    addPublicationEditor({
      publication_date:
        date ||
        isoDate(
          currentDate
        ),
      publication_time:
        "",
      platform:
        "Telegram",
      format:
        "Пост",
      title:
        content?.title ||
        "",
      status:
        "planned",
      description:
        "",
      link:
        "",
      reminder_24h:
        true,
      reminder_3h:
        false,
      reminder_1h:
        false,
      assigneeIds:
        []
    });
  }

  $("deleteContentBtn")
    .classList
    .toggle(
      "hidden",
      !content
    );
}

function closeModal() {
  $("taskModal")
    .classList
    .add("hidden");

  editingContentId =
    null;
}


/* =====================================================
   PUBLICATION EDITOR
===================================================== */

function getFormats(
  platform
) {

  const formats = {
    Telegram: [
      "Пост",
      "Видео",
      "Фото",
      "Опрос"
    ],

    Instagram: [
      "Пост",
      "Reels",
      "Stories"
    ],

    TikTok: [
      "Reels",
      "Видео"
    ],

    VK: [
      "Пост",
      "Клип",
      "Видео",
      "История"
    ],

    YouTube: [
      "Видео",
      "Shorts",
      "Пост"
    ]
  };

  return (
    formats[
      platform
    ] ||
    [
      "Публикация"
    ]
  );
}

function addPublicationEditor(
  publication = {}
) {

  const template =
    $("publicationTemplate");

  const clone =
    template
      .content
      .cloneNode(true);

  const editor =
    clone.querySelector(
      ".publication-editor"
    );

  editor.dataset.id =
    publication.id ||
    "";

  const platform =
    editor.querySelector(
      ".publication-platform"
    );

  const format =
    editor.querySelector(
      ".publication-format"
    );

  const date =
    editor.querySelector(
      ".publication-date"
    );

  const time =
    editor.querySelector(
      ".publication-time"
    );

  const title =
    editor.querySelector(
      ".publication-title"
    );

  const status =
    editor.querySelector(
      ".publication-status"
    );

  const link =
    editor.querySelector(
      ".publication-link"
    );

  const description =
    editor.querySelector(
      ".publication-description"
    );

  const rem24 =
    editor.querySelector(
      ".publication-rem24"
    );

  const rem3 =
    editor.querySelector(
      ".publication-rem3"
    );

  const rem1 =
    editor.querySelector(
      ".publication-rem1"
    );

  platform.value =
    publication.platform ||
    "Telegram";

  fillFormats(
    format,
    platform.value,
    publication.format
  );

  date.value =
    publication.publication_date ||
    isoDate(
      currentDate
    );

  time.value =
    publication.publication_time
      ? formatTime(
          publication.publication_time
        )
      : "";

  title.value =
    publication.title ||
    "";

  status.value =
    publication.status ||
    "planned";

  link.value =
    publication.link ||
    "";

  description.value =
    publication.description ||
    "";

  rem24.checked =
    publication.reminder_24h ??
    true;

  rem3.checked =
    publication.reminder_3h ??
    false;

  rem1.checked =
    publication.reminder_1h ??
    false;

  platform.addEventListener(
    "change",
    () => {

      fillFormats(
        format,
        platform.value
      );
    }
  );

  const pickerButton =
    editor.querySelector(
      ".assignee-picker-button"
    );

  const dropdown =
    editor.querySelector(
      ".assignee-dropdown"
    );

  pickerButton.addEventListener(
    "click",
    e => {

      e.stopPropagation();

      dropdown
        .classList
        .toggle("hidden");

      renderAssigneeOptions(
        editor
      );
    }
  );

  const search =
    editor.querySelector(
      ".assignee-search"
    );

  search.addEventListener(
    "input",
    () =>
      renderAssigneeOptions(
        editor
      )
  );

  const existing =
    publication.assigneeIds ||
    [];

  editor.dataset.assignees =
    JSON.stringify(
      existing
    );

  renderSelectedAssignees(
    editor
  );

  editor
    .querySelector(
      ".remove-publication-btn"
    )
    .addEventListener(
      "click",
      () => {

        editor.remove();

        renumberPublications();
      }
    );

  $("publicationsList")
    .appendChild(
      clone
    );

  renumberPublications();
}

function fillFormats(
  select,
  platform,
  selected = null
) {

  const formats =
    getFormats(
      platform
    );

  select.innerHTML =
    formats
      .map(
        f => `
          <option value="${escapeHtml(
            f
          )}">
            ${escapeHtml(
              f
            )}
          </option>
        `
      )
      .join("");

  if (
    selected &&
    formats.includes(
      selected
    )
  ) {
    select.value =
      selected;
  }
}

function renumberPublications() {

  document
    .querySelectorAll(
      "#publicationsList .publication-editor"
    )
    .forEach(
      (el, index) => {

        const number =
          el.querySelector(
            ".publication-number"
          );

        if (number) {
          number.textContent =
            `Публикация ${
              index + 1
            }`;
        }
      }
    );
}


/* =====================================================
   ASSIGNEES
===================================================== */

function renderAssigneeOptions(
  editor
) {

  const options =
    editor.querySelector(
      ".assignee-options"
    );

  const search =
    editor.querySelector(
      ".assignee-search"
    );

  const query =
    (
      search.value ||
      ""
    ).toLowerCase();

  let selected = [];

  try {
    selected =
      JSON.parse(
        editor.dataset
          .assignees ||
        "[]"
      );
  } catch {
    selected = [];
  }

  const filtered =
    members.filter(
      m => {

        const name =
          m.telegram_first_name ||
          m.name ||
          m.email ||
          "";

        const username =
          m.telegram_username ||
          "";

        return (
          !query ||
          (
            name +
            " " +
            username
          )
            .toLowerCase()
            .includes(
              query
            )
        );
      }
    );

  if (!filtered.length) {

    options.innerHTML =
      `<div class="muted">
        Участники не найдены
      </div>`;

    return;
  }

  options.innerHTML =
    filtered
      .map(
        m => {

          const name =
            m.telegram_first_name ||
            m.name ||
            m.email ||
            "Участник";

          const checked =
            selected.includes(
              m.id
            );

          return `
            <label class="assignee-option">

              <input
                type="checkbox"
                data-assignee="${m.id}"
                ${
                  checked
                    ? "checked"
                    : ""
                }
              />

              <span>

                ${escapeHtml(
                  name
                )}

                ${
                  m.telegram_username
                    ? `
                      <small>
                        @${escapeHtml(
                          m.telegram_username
                        )}
                      </small>
                    `
                    : ""
                }

              </span>

            </label>
          `;
        }
      )
      .join("");

  options
    .querySelectorAll(
      "[data-assignee]"
    )
    .forEach(
      checkbox => {

        checkbox.addEventListener(
          "change",
          () => {

            let ids = [];

            try {
              ids =
                JSON.parse(
                  editor.dataset
                    .assignees ||
                  "[]"
                );
            } catch {
              ids = [];
            }

            const id =
              checkbox.dataset
                .assignee;

            if (
              checkbox.checked
            ) {

              if (
                !ids.includes(
                  id
                )
              ) {
                ids.push(id);
              }

            } else {

              ids =
                ids.filter(
                  x =>
                    x !== id
                );
            }

            editor.dataset.assignees =
              JSON.stringify(
                ids
              );

            renderSelectedAssignees(
              editor
            );
          }
        );
      }
    );
}

function renderSelectedAssignees(
  editor
) {

  const container =
    editor.querySelector(
      ".selected-assignees"
    );

  let ids = [];

  try {
    ids =
      JSON.parse(
        editor.dataset
          .assignees ||
        "[]"
      );
  } catch {
    ids = [];
  }

  if (!ids.length) {

    container.innerHTML =
      `<span class="muted">
        Ответственные не выбраны
      </span>`;

    return;
  }

  container.innerHTML =
    ids
      .map(
        id => {

          const member =
            members.find(
              m =>
                m.id === id
            );

          const name =
            member?.telegram_first_name ||
            member?.name ||
            member?.email ||
            "Участник";

          return `
            <span class="assignee-tag">
              ${escapeHtml(
                name
              )}

              <button
                type="button"
                data-remove-assignee="${id}"
              >
                ×
              </button>
            </span>
          `;
        }
      )
      .join("");

  container
    .querySelectorAll(
      "[data-remove-assignee]"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () => {

            const id =
              button.dataset
                .removeAssignee;

            ids =
              ids.filter(
                x =>
                  x !== id
              );

            editor.dataset.assignees =
              JSON.stringify(
                ids
              );

            renderSelectedAssignees(
              editor
            );

            renderAssigneeOptions(
              editor
            );
          }
        );
      }
    );
}


/* =====================================================
   SAVE CONTENT
===================================================== */

async function saveTask() {

  if (!project) return;

  const title =
    $("contentTitle")
      .value
      .trim();

  if (!title) {

    msg(
      $("modalMessage"),
      "Напиши название контента."
    );

    return;
  }

  const editors =
    Array.from(
      document.querySelectorAll(
        "#publicationsList .publication-editor"
      )
    );

  if (!editors.length) {

    msg(
      $("modalMessage"),
      "Добавь хотя бы одну публикацию."
    );

    return;
  }

  /*
    Сначала создаём/обновляем
    сам контент.
  */

  let contentId =
    editingContentId;

  let contentError;

  if (contentId) {

    const result =
      await sb
        .from("content")
        .update({
          title,
          description:
            $("contentDescription")
              .value,
          updated_at:
            new Date()
              .toISOString()
        })
        .eq(
          "id",
          contentId
        );

    contentError =
      result.error;

  } else {

    const result =
      await sb
        .from("content")
        .insert({
          project_id:
            project.id,
          title,
          description:
            $("contentDescription")
              .value,
          created_by:
            user.id
        })
        .select()
        .single();

    contentError =
      result.error;

    if (!contentError) {
      contentId =
        result.data.id;
    }
  }

  if (contentError) {

    msg(
      $("modalMessage"),
      contentError.message
    );

    return;
  }

  /*
    Сохраняем публикации.
  */

  const oldPublications =
    publications.filter(
      p =>
        p.content_id ===
        contentId
    );

  const keptIds = [];

  for (
    const editor
    of editors
  ) {

    const id =
      editor.dataset.id ||
      "";

    const platform =
      editor.querySelector(
        ".publication-platform"
      ).value;

    const format =
      editor.querySelector(
        ".publication-format"
      ).value;

    const date =
      editor.querySelector(
        ".publication-date"
      ).value;

    const time =
      editor.querySelector(
        ".publication-time"
      ).value ||
      null;

    const publicationTitle =
      editor.querySelector(
        ".publication-title"
      ).value
        .trim() ||
      title;

    if (!date) {

      msg(
        $("modalMessage"),
        "У каждой публикации должна быть дата."
      );

      return;
    }

    const payload = {

      content_id:
        contentId,

      project_id:
        project.id,

      title:
        publicationTitle,

      platform,

      format,

      publication_date:
        date,

      publication_time:
        time,

      status:
        editor.querySelector(
          ".publication-status"
        ).value,

      description:
        editor.querySelector(
          ".publication-description"
        ).value,

      link:
        editor.querySelector(
          ".publication-link"
        ).value ||
        null,

      reminder_24h:
        editor.querySelector(
          ".publication-rem24"
        ).checked,

      reminder_3h:
        editor.querySelector(
          ".publication-rem3"
        ).checked,

      reminder_1h:
        editor.querySelector(
          ".publication-rem1"
        ).checked,

      updated_at:
        new Date()
          .toISOString()
    };

    let saved;

    if (id) {

      const {
        data,
        error
      } =
        await sb
          .from(
            "publications"
          )
          .update(
            payload
          )
          .eq(
            "id",
            id
          )
          .select()
          .single();

      if (error) {

        msg(
          $("modalMessage"),
          error.message
        );

        return;
      }

      saved = data;

    } else {

      const {
        data,
        error
      } =
        await sb
          .from(
            "publications"
          )
          .insert(
            payload
          )
          .select()
          .single();

      if (error) {

        msg(
          $("modalMessage"),
          error.message
        );

        return;
      }

      saved = data;
    }

    keptIds.push(
      saved.id
    );

    /*
      Обновляем ответственных.
    */

    await sb
      .from(
        "publication_assignees"
      )
      .delete()
      .eq(
        "publication_id",
        saved.id
      );

    let assigneeIds = [];

    try {
      assigneeIds =
        JSON.parse(
          editor.dataset
            .assignees ||
          "[]"
        );
    } catch {
      assigneeIds = [];
    }

    if (
      assigneeIds.length
    ) {

      const rows =
        assigneeIds.map(
          userId => ({
            publication_id:
              saved.id,
            user_id:
              userId
          })
        );

      const {
        error
      } =
        await sb
          .from(
            "publication_assignees"
          )
          .insert(
            rows
          );

      if (error) {

        msg(
          $("modalMessage"),
          error.message
        );

        return;
      }
    }
  }

  /*
    Удаляем публикации,
    которые были убраны
    из редактора.
  */

  const removed =
    oldPublications.filter(
      p =>
        !keptIds.includes(
          p.id
        )
    );

  for (
    const p of removed
  ) {

    await sb
      .from(
        "publications"
      )
      .delete()
      .eq(
        "id",
        p.id
      );
  }

  closeModal();

  await loadContent();

  render();

  renderAnalytics();
}


/* =====================================================
   OPEN ONE PUBLICATION
===================================================== */

function openPublication(
  publicationId
) {

  const p =
    publications.find(
      x =>
        x.id ===
        publicationId
    );

  if (!p) return;

  openModal(
    p.content_id
  );
}


/* =====================================================
   DELETE CONTENT
===================================================== */

async function deleteContent() {

  if (!editingContentId)
    return;

  if (
    !confirm(
      "Удалить этот контент и все его публикации?"
    )
  ) {
    return;
  }

  const {
    error
  } =
    await sb
      .from("content")
      .delete()
      .eq(
        "id",
        editingContentId
      );

  if (error) {

    msg(
      $("modalMessage"),
      error.message
    );

    return;
  }

  closeModal();

  await loadContent();

  render();

  renderAnalytics();
}


/* =====================================================
   JOIN PROJECT
===================================================== */

async function joinProject() {

  const input =
    $("projectCodeInput");

  if (!input) return;

  const code =
    input.value.trim();

  if (!code) return;

  const {
    data,
    error
  } =
    await sb.rpc(
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

  await loadContent();

  render();

  msg(
    $("projectInfo"),
    "Ты присоединилась к проекту.",
    true
  );
}


/* =====================================================
   VIEW SWITCHING
===================================================== */

function switchView(
  view
) {

  document
    .querySelectorAll(
      ".view"
    )
    .forEach(
      x =>
        x.classList.add(
          "hidden"
        )
    );

  const target =
    $(view + "View");

  if (target) {
    target.classList.remove(
      "hidden"
    );
  }

  document
    .querySelectorAll(
      ".nav[data-view]"
    )
    .forEach(
      x =>
        x.classList.toggle(
          "active",
          x.dataset.view ===
            view
        )
    );

  const titles = {
    calendar:
      "Календарь",
    list:
      "Контент",
    team:
      "Команда",
    analytics:
      "Анализ"
  };

  if ($("pageTitle")) {
    $("pageTitle")
      .textContent =
      titles[view] ||
      "Media Planner";
  }

  if (
    view ===
    "analytics"
  ) {
    renderAnalytics();
  }

  if (
    view ===
    "team"
  ) {
    renderTeam();
  }
}


/* =====================================================
   BUTTONS
===================================================== */

$("addTaskBtn")?.addEventListener(
  "click",
  () =>
    openModal()
);

$("closeModal")?.addEventListener(
  "click",
  closeModal
);

$("cancelTaskBtn")?.addEventListener(
  "click",
  closeModal
);

$("saveTaskBtn")?.addEventListener(
  "click",
  saveTask
);

$("deleteContentBtn")?.addEventListener(
  "click",
  deleteContent
);

$("addPublicationBtn")?.addEventListener(
  "click",
  () =>
    addPublicationEditor({
      publication_date:
        isoDate(
          currentDate
        ),
      platform:
        "Telegram",
      format:
        "Пост",
      status:
        "planned",
      assigneeIds:
        []
    })
);

$("prevMonth")?.addEventListener(
  "click",
  () => {

    currentDate.setMonth(
      currentDate.getMonth() -
      1
    );

    renderCalendar();
  }
);

$("nextMonth")?.addEventListener(
  "click",
  () => {

    currentDate.setMonth(
      currentDate.getMonth() +
      1
    );

    renderCalendar();
  }
);

$("todayBtn")?.addEventListener(
  "click",
  () => {

    currentDate =
      new Date();

    renderCalendar();
  }
);

$("searchInput")?.addEventListener(
  "input",
  renderList
);

$("statusFilter")?.addEventListener(
  "change",
  renderList
);

$("platformFilter")?.addEventListener(
  "change",
  renderList
);

$("analyticsPeriod")?.addEventListener(
  "change",
  renderAnalytics
);

$("analyticsPlatform")?.addEventListener(
  "change",
  renderAnalytics
);

$("joinProjectBtn")?.addEventListener(
  "click",
  joinProject
);

document
  .querySelectorAll(
    ".nav[data-view]"
  )
  .forEach(
    button => {

      button.addEventListener(
        "click",
        () =>
          switchView(
            button.dataset
              .view
          )
      );
    }
  );


/* =====================================================
   START
===================================================== */

init();
