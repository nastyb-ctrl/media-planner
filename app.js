const SUPABASE_URL = "https://vkvrwayzqrlsfsgjjwpy.supabase.co";
const SUPABASE_KEY = "sb_publishable_-kj7hiC7uou3db2wpwFM_w_jgXQNpnb";

if (!window.supabase?.createClient) {
  document.querySelector(".auth-card")?.replaceChildren();
  const card = document.querySelector(".auth-card");

  if (card) {
    card.innerHTML = `
      <div class="logo-mark">!</div>
      <h1>Не удалось открыть</h1>
      <p>Не загрузился модуль Supabase. Обнови страницу и попробуй ещё раз.</p>
    `;
  }

  throw new Error("Supabase JS не загрузился");
}

const { createClient } = window.supabase;

const db = createClient(
  SUPABASE_URL,
  SUPABASE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  }
);

const tg = window.Telegram?.WebApp;

let currentUser = null;
let currentProfile = null;
let currentProject = null;

let members = [];
let contents = [];
let publications = [];
let assigneeRows = [];

let currentMonth = new Date();
let activePeriod = "week";

let saving = false;

let memberPoll = null;
let plannerPoll = null;

let realtimeChannels = [];

let selectedDayForNewPublication = null;


/* --------------------------------------------------
   ID ALIASES
-------------------------------------------------- */

const ID_ALIASES = {
  modal: [
    "modal",
    "contentModal"
  ],

  editingContentId: [
    "editingContentId",
    "contentId"
  ],

  modalTitle: [
    "modalTitle",
    "contentModalTitle"
  ],

  publicationEditorList: [
    "publicationEditorList",
    "publicationsEditor"
  ],

  saveContentBtn: [
    "saveContentBtn",
    "saveContentButton"
  ],

  cancelContentBtn: [
    "cancelContentBtn",
    "cancelContentButton"
  ],

  closeContentModal: [
    "closeContentModal",
    "closeModal"
  ],

  monthLabel: [
    "monthLabel",
    "currentMonth"
  ],

  todayBtn: [
    "todayBtn",
    "todayButton"
  ],

  addPublicationTop: [
    "addPublicationTop",
    "topAddButton"
  ],

  addContentInline: [
    "addContentInline",
    "addContentButton"
  ],

  contentPlatformFilter: [
    "contentPlatformFilter",
    "platformFilter"
  ],

  statTotal: [
    "statTotal",
    "analyticsTotal"
  ],

  statWeek: [
    "statWeek",
    "analyticsAverage"
  ],

  platformStats: [
    "platformStats",
    "analyticsPlatforms"
  ],

  formatStats: [
    "formatStats",
    "analyticsFormats"
  ],

  weekdayStats: [
    "weekdayStats",
    "analyticsWeekdays"
  ],

  assigneeStats: [
    "assigneeStats",
    "analyticsAssignees"
  ]
};


const $ = id => {
  const ids = ID_ALIASES[id] || [id];

  for (const candidate of ids) {
    const el = document.getElementById(candidate);

    if (el) {
      return el;
    }
  }

  return null;
};


/* --------------------------------------------------
   HELPERS
-------------------------------------------------- */

const esc = value =>
  String(value ?? "").replace(
    /[&<>"']/g,
    c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;"
    }[c])
  );


const pad = n =>
  String(n).padStart(2, "0");


const isoToday = () => {
  const d = new Date();

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};


const monthNames = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь"
];


const shortMonths = [
  "янв",
  "фев",
  "мар",
  "апр",
  "май",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек"
];


const weekdayNames = [
  "Вс",
  "Пн",
  "Вт",
  "Ср",
  "Чт",
  "Пт",
  "Сб"
];


function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}


function formatDate(date) {
  if (!date) return "";

  const [y, m, d] = date.split("-").map(Number);

  return `${d} ${shortMonths[m - 1]}`;
}


function formatLongDate(date) {
  if (!date) return "";

  const [y, m, d] = date.split("-").map(Number);

  return `${d} ${shortMonths[m - 1]} ${y}`;
}


function sortPublication(a, b) {
  return `${a.publication_date}T${a.publication_time || "23:59:59"}`
    .localeCompare(
      `${b.publication_date}T${b.publication_time || "23:59:59"}`
    );
}


function statusLabel(status) {
  if (status === "progress") {
    return "В работе";
  }

  if (status === "done") {
    return "Готово";
  }

  return "Запланировано";
}


function platformClass(platform) {
  return String(platform || "")
    .toLowerCase()
    .replace(/[^a-zа-яё]/gi, "");
}


function toast(text) {
  document.querySelector(".toast")?.remove();

  const el = document.createElement("div");

  el.className = "toast";
  el.textContent = text;

  document.body.appendChild(el);

  setTimeout(() => {
    el.remove();
  }, 2200);
}


function telegramInitData() {
  return tg?.initData || "";
}


/* --------------------------------------------------
   BOOT
-------------------------------------------------- */

async function boot() {
  try {

    tg?.ready();
    tg?.expand();

    tg?.setHeaderColor?.("#f7f7f5");
    tg?.setBackgroundColor?.("#f7f7f5");


    let session =
      (await db.auth.getSession()).data.session;


    if (!session) {

      const { error } =
        await db.auth.signInAnonymously();

      if (error) {
        throw error;
      }

      session =
        (await db.auth.getSession()).data.session;
    }


    currentUser = session?.user;


    if (!currentUser) {
      throw new Error(
        "Не удалось создать рабочую сессию."
      );
    }


    const initData =
      telegramInitData();


    if (initData) {

      const { error } =
        await db.functions.invoke(
          "telegram-auth",
          {
            body: {
              initData
            }
          }
        );


      if (error) {
        console.warn(
          "telegram-auth:",
          error
        );
      }
    }


    await loadProfile();

    await ensureProject();

    await loadAll();

    setupRealtime();

    startPolling();

    bindEvents();

    showApp();


  } catch (error) {

    console.error(error);

    showApp();

    bindEvents();

    toast(
      "Не удалось загрузить данные планера"
    );
  }
}


/* --------------------------------------------------
   PROFILE
-------------------------------------------------- */

async function loadProfile() {

  const {
    data,
    error
  } = await db
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .maybeSingle();


  if (error) {
    throw error;
  }


  currentProfile =
    data || {
      id: currentUser.id,
      telegram_first_name: "Участник"
    };
}


/* --------------------------------------------------
   PROJECT
-------------------------------------------------- */

async function ensureProject() {

  const {
    data,
    error
  } = await db.rpc(
    "get_default_project_for_user"
  );


  if (error) {
    throw error;
  }


  currentProject =
    Array.isArray(data)
      ? data[0]
      : data;


  if (!currentProject) {
    throw new Error(
      "Не найден проект команды."
    );
  }
}


/* --------------------------------------------------
   LOAD ALL
-------------------------------------------------- */

async function loadAll() {

  await Promise.all([
    loadMembers(),
    loadContent()
  ]);

  renderEverything();
}


/* --------------------------------------------------
   MEMBERS
-------------------------------------------------- */

async function loadMembers() {

  const {
    data,
    error
  } = await db
    .from("profiles")
    .select(
      "id,telegram_id,telegram_username,telegram_first_name,telegram_photo_url"
    )
    .not(
      "telegram_id",
      "is",
      null
    )
    .order(
      "telegram_first_name",
      {
        ascending: true
      }
    );


  if (error) {

    members =
      currentProfile?.telegram_id
        ? [currentProfile]
        : [];

    return;
  }


  members = data || [];


  if (
    currentProfile?.telegram_id &&
    !members.some(
      m => m.id === currentProfile.id
    )
  ) {

    members.unshift(
      currentProfile
    );
  }
}


/* --------------------------------------------------
   CONTENT
-------------------------------------------------- */

async function loadContent() {

  if (!currentProject) {
    return;
  }


  const {
    data: c,
    error: ce
  } = await db
    .from("content")
    .select("*")
    .eq(
      "project_id",
      currentProject.id
    )
    .order(
      "created_at",
      {
        ascending: false
      }
    );


  if (ce) {
    throw ce;
  }


  const {
    data: p,
    error: pe
  } = await db
    .from("publications")
    .select("*")
    .eq(
      "project_id",
      currentProject.id
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
        ascending: true,
        nullsFirst: false
      }
    );


  if (pe) {
    throw pe;
  }


  const ids =
    (p || []).map(
      x => x.id
    );


  let a = [];


  if (ids.length) {

    const {
      data,
      error
    } = await db
      .from("publication_assignees")
      .select(
        "publication_id,user_id"
      )
      .in(
        "publication_id",
        ids
      );


    if (error) {
      throw error;
    }


    a = data || [];
  }


  contents = c || [];

  publications = p || [];

  assigneeRows = a;
}


/* --------------------------------------------------
   REALTIME
-------------------------------------------------- */

function setupRealtime() {

  realtimeChannels.forEach(
    ch => db.removeChannel(ch)
  );

  realtimeChannels = [];


  [
    "content",
    "publications",
    "publication_assignees"
  ].forEach(table => {

    const channel =
      db.channel(
        `planner-${table}-${Math.random()}`
      )

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table
        },
        async () => {

          try {

            await loadContent();

            renderEverything();

          } catch (e) {

            console.warn(e);
          }
        }
      )

      .subscribe();


    realtimeChannels.push(
      channel
    );
  });
}


/* --------------------------------------------------
   POLLING
-------------------------------------------------- */

function startPolling() {

  clearInterval(memberPoll);

  clearInterval(plannerPoll);


  memberPoll =
    setInterval(
      async () => {

        try {

          await loadMembers();

          renderTeam();

          renderAnalytics();

        } catch (e) {}

      },
      15000
    );


  plannerPoll =
    setInterval(
      async () => {

        try {

          await loadContent();

          renderEverything();

        } catch (e) {

          console.warn(e);
        }

      },
      15000
    );
}


/* --------------------------------------------------
   SHOW APP
-------------------------------------------------- */

function showApp() {

  $("authScreen")?.classList.add(
    "hidden"
  );

  $("app")?.classList.remove(
    "hidden"
  );


  if ($("calendarView")) {

    switchView(
      "calendarView"
    );
  }
}


function showAuthError(message) {

  const card =
    document.querySelector(
      ".auth-card"
    );


  if (card) {

    card.innerHTML = `
      <div class="logo-mark">!</div>
      <h1>Не удалось открыть</h1>
      <p>${esc(message)}</p>
    `;
  }
}


/* --------------------------------------------------
   NAVIGATION
-------------------------------------------------- */

function switchView(viewId) {

  document
    .querySelectorAll(".view")
    .forEach(view => {

      view.classList.toggle(
        "hidden",
        view.id !== viewId
      );
    });


  document
    .querySelectorAll(".nav-item")
    .forEach(button => {

      button.classList.toggle(
        "active",
        button.dataset.view === viewId
      );
    });


  window.scrollTo({
    top: 0,
    behavior: "instant"
  });
}


/* --------------------------------------------------
   RENDER EVERYTHING
-------------------------------------------------- */

function renderEverything() {

  renderCalendar();

  renderUpcoming();

  renderContent();

  renderTeam();

  renderAnalytics();
}


/* --------------------------------------------------
   CALENDAR
-------------------------------------------------- */

function renderCalendar() {

  const grid =
    $("calendarGrid");


  if (!grid) {
    return;
  }


  const year =
    currentMonth.getFullYear();

  const month =
    currentMonth.getMonth();


  const monthLabel =
    $("monthLabel");


  if (monthLabel) {

    monthLabel.textContent =
      `${monthNames[month]} ${year}`;
  }


  const first =
    new Date(
      year,
      month,
      1
    );


  const daysInMonth =
    new Date(
      year,
      month + 1,
      0
    ).getDate();


  const leading =
    (first.getDay() + 6) % 7;


  const total =
    Math.ceil(
      (leading + daysInMonth) / 7
    ) * 7;


  grid.innerHTML = "";


  for (
    let i = 0;
    i < total;
    i++
  ) {

    const day =
      i - leading + 1;


    const dateObj =
      new Date(
        year,
        month,
        day
      );


    const date =
      toISO(dateObj);


    const cell =
      document.createElement(
        "div"
      );


    cell.className =
      "calendar-day";


    if (
      dateObj.getMonth() !== month
    ) {

      cell.classList.add(
        "muted"
      );
    }


    if (
      date === isoToday()
    ) {

      cell.classList.add(
        "today"
      );
    }


    cell.innerHTML = `
      <div class="day-number">
        ${dateObj.getDate()}
      </div>
      <div class="calendar-publications"></div>
    `;


    cell.addEventListener(
      "click",
      () => openDayDetails(date)
    );


    const list =
      publications
        .filter(
          p =>
            p.publication_date === date
        )
        .sort(sortPublication);


    const pubContainer =
      cell.querySelector(
        ".calendar-publications"
      );


    list
      .slice(0, 3)
      .forEach(p => {

        const chip =
          document.createElement(
            "button"
          );


        chip.type =
          "button";


        chip.className =
          `calendar-publication ${platformClass(p.platform)}`;


        chip.innerHTML = `
          ${p.publication_time
            ? `<b>${esc(p.publication_time.slice(0, 5))}</b> `
            : ""}
          ${esc(p.title)}
        `;


        chip.addEventListener(
          "click",
          event => {

            event.stopPropagation();

            openContent(
              p.content_id
            );
          }
        );


        pubContainer?.appendChild(
          chip
        );
      });


    if (
      list.length > 3
    ) {

      const more =
        document.createElement(
          "div"
        );


      more.className =
        "calendar-publication";


      more.textContent =
        `+${list.length - 3} ещё`;


      pubContainer?.appendChild(
        more
      );
    }


    grid.appendChild(
      cell
    );
  }
}


/* --------------------------------------------------
   UPCOMING
-------------------------------------------------- */

function renderUpcoming() {

  const container =
    $("upcomingList");


  if (!container) {
    return;
  }


  const now =
    new Date();


  const upcoming =
    publications
      .filter(p => {

        const value =
          `${p.publication_date}T${p.publication_time || "23:59:59"}`;

        return new Date(value) >= now;
      })
      .sort(sortPublication)
      .slice(0, 6);


  if (!upcoming.length) {

    container.innerHTML = `
      <div class="empty-state">
        <strong>Публикаций пока нет</strong>
        Добавьте первый контент в план.
      </div>
    `;

    return;
  }


  container.innerHTML =
    upcoming
      .map(p => {

        return `
          <article
            class="upcoming-card"
            data-open-content="${p.content_id}"
          >

            <div class="upcoming-date">
              ${formatLongDate(p.publication_date)}
              ${p.publication_time
                ? ` · ${esc(p.publication_time.slice(0, 5))}`
                : ""}
            </div>

            <div class="upcoming-title">
              ${esc(p.title)}
            </div>

            <div class="upcoming-meta">

              <span
                class="platform-dot ${platformClass(p.platform)}"
              ></span>

              <span>
                ${esc(p.platform)}
              </span>

              <span>·</span>

              <span>
                ${esc(p.format)}
              </span>

            </div>

          </article>
        `;
      })
      .join("");


  container
    .querySelectorAll(
      "[data-open-content]"
    )
    .forEach(card => {

      card.addEventListener(
        "click",
        () =>
          openContent(
            card.dataset.openContent
          )
      );
    });
}


/* --------------------------------------------------
   CONTENT LIST
-------------------------------------------------- */

function renderContent() {

  const container =
    $("contentList");


  if (!container) {
    return;
  }


  const search =
    (
      $("contentSearch")?.value ||
      ""
    )
      .toLowerCase()
      .trim();


  const platform =
    $("contentPlatformFilter")
      ?.value ||
    "all";


  const filtered =
    contents.filter(content => {

      const related =
        publications.filter(
          p =>
            p.content_id === content.id
        );


      const text =
        [
          content.title,
          content.description,
          ...related.map(
            p => p.title
          )
        ]
          .join(" ")
          .toLowerCase();


      const matchesSearch =
        !search ||
        text.includes(search);


      const matchesPlatform =
        platform === "all" ||
        related.some(
          p =>
            p.platform === platform
        );


      return (
        matchesSearch &&
        matchesPlatform
      );
    });


  if (!filtered.length) {

    container.innerHTML = `
      <div class="empty-state">
        <strong>Ничего не найдено</strong>
        Попробуйте изменить поиск или добавить контент.
      </div>
    `;

    return;
  }


  container.innerHTML =
    filtered
      .map(content => {

        const related =
          publications
            .filter(
              p =>
                p.content_id === content.id
            )
            .sort(sortPublication);


        return `
          <article
            class="content-card"
            data-content-id="${content.id}"
          >

            <div class="content-card-head">

              <div>

                <h3>
                  ${esc(content.title)}
                </h3>

                ${
                  content.description
                    ? `
                      <div class="content-description">
                        ${esc(content.description)}
                      </div>
                    `
                    : ""
                }

              </div>

            </div>


            <div class="content-publications">

              ${
                related.length
                  ? related
                      .map(
                        p => `
                          <span class="content-chip">
                            ${esc(p.platform)}
                            ·
                            ${formatDate(p.publication_date)}
                            ${
                              p.publication_time
                                ? ` · ${esc(p.publication_time.slice(0, 5))}`
                                : ""
                            }
                          </span>
                        `
                      )
                      .join("")
                  : `
                    <span class="content-chip">
                      Без публикаций
                    </span>
                  `
              }

            </div>

          </article>
        `;
      })
      .join("");


  container
    .querySelectorAll(
      "[data-content-id]"
    )
    .forEach(card => {

      card.addEventListener(
        "click",
        () =>
          openContent(
            card.dataset.contentId
          )
      );
    });
}


/* --------------------------------------------------
   TEAM
-------------------------------------------------- */

function renderTeam() {

  const container =
    $("teamList");


  if (!container) {
    return;
  }


  const count =
    $("teamCount");


  if (count) {

    const n =
      members.length;


    count.textContent =
      `${n} ${
        n === 1
          ? "участник"
          : n >= 2 && n <= 4
            ? "участника"
            : "участников"
      }`;
  }


  if (!members.length) {

    container.innerHTML = `
      <div class="empty-state">
        <strong>Команда пока не определилась</strong>
        Участники появятся после входа через Telegram.
      </div>
    `;

    return;
  }


  container.innerHTML =
    members
      .map(member => {

        const name =
          member.telegram_first_name ||
          member.telegram_username ||
          "Участник";


        const username =
          member.telegram_username
            ? `@${member.telegram_username}`
            : "Участник команды";


        const initials =
          name
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map(
              x =>
                x[0]
                  ?.toUpperCase()
            )
            .join("");


        return `
          <article class="team-card">

            <div class="avatar">
              ${esc(initials || "•")}
            </div>

            <div>

              <div class="team-name">
                ${esc(name)}
              </div>

              <div class="team-role">
                ${esc(username)}
              </div>

            </div>

          </article>
        `;
      })
      .join("");
}


/* --------------------------------------------------
   ANALYTICS
-------------------------------------------------- */

function renderAnalytics() {

  const total =
    $("statTotal");

  const weekly =
    $("statWeek");


  if (!total || !weekly) {
    return;
  }


  const platform =
    $("analyticsPlatform")
      ?.value ||
    "all";


  const now =
    new Date();


  let from = null;


  if (activePeriod === "week") {

    from =
      new Date(
        now
      );

    from.setDate(
      from.getDate() - 7
    );
  }


  if (activePeriod === "month") {

    from =
      new Date(
        now
      );

    from.setMonth(
      from.getMonth() - 1
    );
  }


  if (
    activePeriod === "3months"
  ) {

    from =
      new Date(
        now
      );

    from.setMonth(
      from.getMonth() - 3
    );
  }


  const filtered =
    publications.filter(p => {

      if (
        platform !== "all" &&
        p.platform !== platform
      ) {
        return false;
      }


      if (!from) {
        return true;
      }


      return (
        new Date(
          `${p.publication_date}T${p.publication_time || "00:00:00"}`
        ) >= from
      );
    });


  total.textContent =
    filtered.length;


  const first =
    filtered
      .map(
        p =>
          new Date(
            p.publication_date
          )
      )
      .sort(
        (a, b) =>
          a - b
      )[0];


  const last =
    filtered
      .map(
        p =>
          new Date(
            p.publication_date
          )
      )
      .sort(
        (a, b) =>
          b - a
      )[0];


  let weeks = 1;


  if (
    first &&
    last
  ) {

    weeks =
      Math.max(
        1,
        Math.ceil(
          (
            last - first
          ) /
          (
            7 *
            24 *
            60 *
            60 *
            1000
          )
        ) + 1
      );
  }


  weekly.textContent =
    Math.round(
      filtered.length /
      weeks
    );


  renderAnalyticsGroup(
    $("platformStats"),
    filtered,
    p => p.platform
  );


  renderAnalyticsGroup(
    $("formatStats"),
    filtered,
    p => p.format
  );


  renderAnalyticsGroup(
    $("weekdayStats"),
    filtered,
    p =>
      weekdayNames[
        new Date(
          `${p.publication_date}T12:00:00`
        ).getDay()
      ]
  );


  renderAnalyticsGroup(
    $("assigneeStats"),
    filtered,
    p => {

      const rows =
        assigneeRows.filter(
          a =>
            a.publication_id === p.id
        );


      if (!rows.length) {
        return "Без ответственного";
      }


      return rows
        .map(row => {

          const member =
            members.find(
              m =>
                m.id === row.user_id
            );


          return (
            member?.telegram_first_name ||
            "Участник"
          );
        })
        .join(", ");
    }
  );
}


function renderAnalyticsGroup(
  container,
  data,
  getter
) {

  if (!container) {
    return;
  }


  const counts = {};


  data.forEach(item => {

    const key =
      getter(item) ||
      "Не указано";


    counts[key] =
      (counts[key] || 0) + 1;
  });


  const rows =
    Object.entries(counts)
      .sort(
        (a, b) =>
          b[1] - a[1]
      );


  if (!rows.length) {

    container.innerHTML = `
      <div class="empty-state">
        Пока нет данных
      </div>
    `;

    return;
  }


  container.innerHTML =
    rows
      .map(
        ([name, count]) => `
          <div class="analytics-row">
            <span>
              ${esc(name)}
            </span>

            <strong>
              ${count}
            </strong>
          </div>
        `
      )
      .join("");
}


/* --------------------------------------------------
   DAY DETAILS
-------------------------------------------------- */

function openDayDetails(date) {

  selectedDayForNewPublication =
    date;


  const modal =
    $("dayModal");


  if (!modal) {
    return;
  }


  const list =
    publications
      .filter(
        p =>
          p.publication_date === date
      )
      .sort(sortPublication);


  const eyebrow =
    $("dayModalEyebrow");


  const title =
    $("dayModalTitle");


  const subtitle =
    $("dayModalSubtitle");


  if (eyebrow) {
    eyebrow.textContent =
      "РАСПИСАНИЕ";
  }


  if (title) {
    title.textContent =
      formatLongDate(date);
  }


  if (subtitle) {

    subtitle.textContent =
      list.length
        ? `${list.length} ${
            list.length === 1
              ? "публикация"
              : "публикации"
          }`
        : "На этот день пока ничего нет";
  }


  const container =
    $("dayPublicationList");


  if (!container) {
    return;
  }


  if (!list.length) {

    container.innerHTML = `
      <div class="empty-state">
        <strong>Публикаций нет</strong>
        Можно сразу добавить публикацию на этот день.
      </div>
    `;

  } else {

    container.innerHTML =
      list
        .map(p => {

          return `
            <article
              class="day-publication"
              data-edit-publication="${p.id}"
            >

              <div class="day-publication-title">
                ${esc(p.title)}
              </div>

              <div class="day-publication-meta">

                <span>
                  ${esc(p.platform)}
                </span>

                <span>
                  ·
                </span>

                <span>
                  ${esc(p.format)}
                </span>

                ${
                  p.publication_time
                    ? `
                      <span>
                        ·
                        ${esc(
                          p.publication_time.slice(0, 5)
                        )}
                      </span>
                    `
                    : ""
                }

                <span
                  class="status-badge ${
                    p.status === "done"
                      ? "done"
                      : p.status === "progress"
                        ? "progress"
                        : ""
                  }"
                >
                  ${statusLabel(p.status)}
                </span>

              </div>

            </article>
          `;
        })
        .join("");


    container
      .querySelectorAll(
        "[data-edit-publication]"
      )
      .forEach(card => {

        card.addEventListener(
          "click",
          () => {

            const publication =
              publications.find(
                p =>
                  p.id ===
                  card.dataset.editPublication
              );


            if (
              publication
            ) {

              closeDayDetails();

              openContent(
                publication.content_id
              );
            }
          }
        );
      });
  }


  modal.classList.remove(
    "hidden"
  );
}


function closeDayDetails() {

  $("dayModal")?.classList.add(
    "hidden"
  );
}


/* --------------------------------------------------
   CONTENT MODAL
-------------------------------------------------- */

function openModal(
  contentId = null,
  presetDate = null
) {

  const modal =
    $("modal");


  if (!modal) {
    return;
  }


  const idField =
    $("editingContentId");


  const title =
    $("modalTitle");


  const contentTitle =
    $("contentTitle");


  const description =
    $("contentDescription");


  const deleteButton =
    $("deleteContentBtn");


  if (idField) {
    idField.value =
      contentId || "";
  }


  if (title) {

    title.textContent =
      contentId
        ? "Редактировать контент"
        : "Новый контент";
  }


  if (contentId) {

    const content =
      contents.find(
        c =>
          c.id === contentId
      );


    if (!content) {
      return;
    }


    if (contentTitle) {
      contentTitle.value =
        content.title || "";
    }


    if (description) {
      description.value =
        content.description || "";
    }


    deleteButton?.classList.remove(
      "hidden"
    );


    const pubs =
      publications
        .filter(
          p =>
            p.content_id === contentId
        )
        .sort(sortPublication);


    const list =
      $("publicationEditorList");


    if (list) {

      list.innerHTML = "";


      pubs.forEach(
        p =>
          addPublicationEditor(
            p
          )
      );
    }

  } else {

    if (contentTitle) {
      contentTitle.value = "";
    }


    if (description) {
      description.value = "";
    }


    deleteButton?.classList.add(
      "hidden"
    );


    const list =
      $("publicationEditorList");


    if (list) {

      list.innerHTML = "";

      addPublicationEditor(
        null,
        presetDate
      );
    }
  }


  modal.classList.remove(
    "hidden"
  );
}


function closeModal() {

  $("modal")?.classList.add(
    "hidden"
  );
}


/* --------------------------------------------------
   OPEN CONTENT
-------------------------------------------------- */

function openContent(
  contentId
) {

  switchView(
    "contentView"
  );


  setTimeout(
    () =>
      openModal(
        contentId
      ),
    50
  );
}


/* --------------------------------------------------
   ADD PUBLICATION EDITOR
-------------------------------------------------- */

function addPublicationEditor(
  data = null,
  presetDate = null
) {

  const wrap =
    $("publicationEditorList");


  if (!wrap) {
    return;
  }


  const node =
    document.createElement(
      "article"
    );


  node.className =
    "publication-editor";


  node.dataset.publication = "";


  node.dataset.existingId =
    data?.id || "";


  const selected =
    new Set(
      data
        ? assigneeRows
            .filter(
              x =>
                x.publication_id ===
                data.id
            )
            .map(
              x =>
                x.user_id
            )
        : []
    );


  node._selected =
    selected;


  node.innerHTML = `

    <div class="publication-editor-head">

      <div class="pub-number">
        Публикация
      </div>

      <button
        type="button"
        class="remove-publication"
      >
        Удалить
      </button>

    </div>


    <div class="form-grid">

      <label class="field full">

        <span>
          Название
        </span>

        <input
          data-field="title"
          required
          placeholder="Название публикации"
          value="${esc(
            data?.title || ""
          )}"
        >

      </label>


      <label class="field">

        <span>
          Соцсеть
        </span>

        <select data-field="platform">

          <option>Telegram</option>

          <option>Instagram</option>

          <option>VK</option>

          <option>TikTok</option>

          <option>YouTube</option>

          <option>Другое</option>

        </select>

      </label>


      <label class="field">

        <span>
          Формат
        </span>

        <input
          data-field="format"
          value="${esc(
            data?.format ||
            "Пост"
          )}"
          placeholder="Пост / Рилс / Видео"
        >

      </label>


      <label class="field">

        <span>
          Дата
        </span>

        <input
          data-field="date"
          type="date"
          required
          value="${esc(
            data?.publication_date ||
            presetDate ||
            isoToday()
          )}"
        >

      </label>


      <label class="field">

        <span>
          Время
        </span>

        <input
          data-field="time"
          type="time"
          value="${esc(
            data?.publication_time
              ? data.publication_time.slice(0, 5)
              : ""
          )}"
        >

      </label>


      <label class="field">

        <span>
          Статус
        </span>

        <select data-field="status">

          <option value="planned">
            Запланировано
          </option>

          <option value="progress">
            В работе
          </option>

          <option value="done">
            Готово
          </option>

        </select>

      </label>


      <label class="field full">

        <span>
          Ссылка
        </span>

        <input
          data-field="link"
          type="url"
          placeholder="https://…"
          value="${esc(
            data?.link || ""
          )}"
        >

      </label>


      <label class="field full">

        <span>
          Комментарий
        </span>

        <textarea
          data-field="description"
          rows="2"
          placeholder="Дополнительная информация"
        >${esc(
          data?.description || ""
        )}</textarea>

      </label>

    </div>


    <div class="field">

      <span class="field-label">
        Ответственные
      </span>


      <div
        class="selected-assignees"
        data-selected
      ></div>


      <div class="assignee-picker">

        <input
          data-search
          type="search"
          placeholder="Поиск участника"
        >


        <div data-options></div>

      </div>

    </div>


    <div class="reminders">

      <label>

        <input
          data-reminder="24h"
          type="checkbox"
          ${
            data
              ? (
                  data.reminder_24h
                    ? "checked"
                    : ""
                )
              : "checked"
          }
        >

        за 24 часа

      </label>


      <label>

        <input
          data-reminder="3h"
          type="checkbox"
          ${
            data?.reminder_3h
              ? "checked"
              : ""
          }
        >

        за 3 часа

      </label>


      <label>

        <input
          data-reminder="1h"
          type="checkbox"
          ${
            data?.reminder_1h
              ? "checked"
              : ""
          }
        >

        за 1 час

      </label>

    </div>

  `;


  const platform =
    node.querySelector(
      '[data-field="platform"]'
    );


  const status =
    node.querySelector(
      '[data-field="status"]'
    );


  if (platform) {

    platform.value =
      data?.platform ||
      "Telegram";
  }


  if (status) {

    status.value =
      data?.status ||
      "planned";
  }


  const renderPicker =
    () => {

      const search =
        (
          node.querySelector(
            "[data-search]"
          )?.value ||
          ""
        )
          .toLowerCase()
          .trim();


      const selectedBox =
        node.querySelector(
          "[data-selected]"
        );


      const optionsBox =
        node.querySelector(
          "[data-options]"
        );


      const chosen =
        [...selected]
          .map(
            id =>
              members.find(
                m =>
                  m.id === id
              )
          )
          .filter(Boolean);


      if (selectedBox) {

        selectedBox.innerHTML =
          chosen.length

            ? chosen
                .map(
                  m => `
                    <span class="assignee-chip">

                      ${esc(
                        m.telegram_first_name ||
                        "Участник"
                      )}

                      <button
                        type="button"
                        data-remove="${m.id}"
                      >
                        ×
                      </button>

                    </span>
                  `
                )
                .join("")

            : "";
      }


      const filtered =
        members.filter(
          m =>
            (
              m.telegram_first_name ||
              ""
            )
              .toLowerCase()
              .includes(search)

            ||

            (
              m.telegram_username ||
              ""
            )
              .toLowerCase()
              .includes(search)
        );


      if (optionsBox) {

        optionsBox.innerHTML = `

          <div class="assignee-options">

            ${
              filtered.length

                ? filtered
                    .map(
                      m => `
                        <label class="assignee-option">

                          <input
                            type="checkbox"
                            data-user="${m.id}"
                            ${
                              selected.has(
                                m.id
                              )
                                ? "checked"
                                : ""
                            }
                          >

                          <span>

                            ${esc(
                              m.telegram_first_name ||
                              "Без имени"
                            )}

                            ${
                              m.telegram_username
                                ? ` · @${esc(
                                    m.telegram_username
                                  )}`
                                : ""
                            }

                          </span>

                        </label>
                      `
                    )
                    .join("")

                : `
                    <div class="empty-state">
                      Участник не найден
                    </div>
                  `
            }

          </div>

        `;
      }


      optionsBox
        ?.querySelectorAll(
          "[data-user]"
        )
        .forEach(
          checkbox => {

            checkbox.addEventListener(
              "change",
              () => {

                if (
                  checkbox.checked
                ) {

                  selected.add(
                    checkbox.dataset.user
                  );

                } else {

                  selected.delete(
                    checkbox.dataset.user
                  );
                }


                renderPicker();
              }
            );
          }
        );


      selectedBox
        ?.querySelectorAll(
          "[data-remove]"
        )
        .forEach(
          button => {

            button.addEventListener(
              "click",
              () => {

                selected.delete(
                  button.dataset.remove
                );

                renderPicker();
              }
            );
          }
        );
    };


  node
    .querySelector(
      "[data-search]"
    )
    ?.addEventListener(
      "input",
      renderPicker
    );


  renderPicker();


  node
    .querySelector(
      ".remove-publication"
    )
    ?.addEventListener(
      "click",
      () => {

        const all =
          document.querySelectorAll(
            "#publicationEditorList [data-publication]"
          );


        if (
          all.length <= 1
        ) {

          toast(
            "Должна остаться хотя бы одна публикация"
          );

          return;
        }


        node.remove();

        renumberEditors();
      }
    );


  wrap.appendChild(
    node
  );


  renumberEditors();
}


/* --------------------------------------------------
   RENUMBER
-------------------------------------------------- */

function renumberEditors() {

  document
    .querySelectorAll(
      "#publicationEditorList [data-publication] .pub-number"
    )
    .forEach(
      (el, i) => {

        el.textContent =
          `Публикация ${i + 1}`;
      }
    );
}


/* --------------------------------------------------
   SAVE CONTENT
-------------------------------------------------- */

async function saveContent(
  event
) {

  event.preventDefault();


  if (
    saving ||
    !currentProject
  ) {
    return;
  }


  const title =
    $("contentTitle")
      ?.value
      .trim();


  if (!title) {

    toast(
      "Введите название контента"
    );

    return;
  }


  const nodes =
    [
      ...document.querySelectorAll(
        "#publicationEditorList [data-publication]"
      )
    ];


  if (!nodes.length) {

    toast(
      "Добавьте хотя бы одну публикацию"
    );

    return;
  }


  for (
    const node of nodes
  ) {

    const pubTitle =
      node.querySelector(
        '[data-field="title"]'
      )?.value
        ?.trim();


    const date =
      node.querySelector(
        '[data-field="date"]'
      )?.value;


    if (
      !pubTitle ||
      !date
    ) {

      toast(
        "Заполните название и дату публикации"
      );

      return;
    }
  }


  saving = true;


  const button =
    $("saveContentBtn");


  if (button) {

    button.disabled =
      true;

    button.textContent =
      "Сохраняем…";
  }


  try {

    const id =
      $("editingContentId")
        ?.value ||
      null;


    const payload = {

      title,

      description:
        $("contentDescription")
          ?.value
          ?.trim() ||
        null
    };


    let saved;


    if (id) {

      const {
        data,
        error
      } = await db
        .from("content")
        .update(payload)
        .eq("id", id)
        .select()
        .single();


      if (error) {
        throw error;
      }


      saved = data;

    } else {

      const {
        data,
        error
      } = await db
        .from("content")
        .insert({
          ...payload,
          project_id:
            currentProject.id,
          created_by:
            currentUser.id
        })
        .select()
        .single();


      if (error) {
        throw error;
      }


      saved = data;
    }


    const kept = [];


    for (
      const node of nodes
    ) {

      const get =
        field =>
          node.querySelector(
            `[data-field="${field}"]`
          )?.value ||
          "";


      const pubPayload = {

        content_id:
          saved.id,

        project_id:
          currentProject.id,

        title:
          get("title")
            .trim(),

        platform:
          get("platform"),

        format:
          get("format")
            .trim() ||
          "Пост",

        publication_date:
          get("date"),

        publication_time:
          get("time") ||
          null,

        status:
          get("status"),

        link:
          get("link")
            .trim() ||
          null,

        description:
          get("description")
            .trim() ||
          null,

        reminder_24h:
          node.querySelector(
            '[data-reminder="24h"]'
          )?.checked ||
          false,

        reminder_3h:
          node.querySelector(
            '[data-reminder="3h"]'
          )?.checked ||
          false,

        reminder_1h:
          node.querySelector(
            '[data-reminder="1h"]'
          )?.checked ||
          false
      };


      const existingId =
        node.dataset.existingId;


      const result =
        existingId

          ? await db
              .from("publications")
              .update(
                pubPayload
              )
              .eq(
                "id",
                existingId
              )
              .select()
              .single()

          : await db
              .from("publications")
              .insert(
                pubPayload
              )
              .select()
              .single();


      if (result.error) {
        throw result.error;
      }


      const pub =
        result.data;


      kept.push(
        pub.id
      );


      const del =
        await db
          .from(
            "publication_assignees"
          )
          .delete()
          .eq(
            "publication_id",
            pub.id
          );


      if (del.error) {
        throw del.error;
      }


      const selected =
        [
          ...(node._selected ||
            new Set())
        ];


      if (
        selected.length
      ) {

        const ins =
          await db
            .from(
              "publication_assignees"
            )
            .insert(
              selected.map(
                user_id => ({
                  publication_id:
                    pub.id,

                  user_id
                })
              )
            );


        if (ins.error) {
          throw ins.error;
        }
      }
    }


    if (id) {

      const removed =
        publications
          .filter(
            p =>
              p.content_id === id &&
              !kept.includes(
                p.id
              )
          )
          .map(
            p =>
              p.id
          );


      if (
        removed.length
      ) {

        const result =
          await db
            .from(
              "publications"
            )
            .delete()
            .in(
              "id",
              removed
            );


        if (result.error) {
          throw result.error;
        }
      }
    }


    closeModal();


    await loadContent();


    renderEverything();


    toast(
      "Сохранено"
    );


  } catch (error) {

    console.error(error);


    toast(
      error?.message ||
      "Ошибка сохранения"
    );


  } finally {

    saving = false;


    if (button) {

      button.disabled =
        false;

      button.textContent =
        "Сохранить";
    }
  }
}


/* --------------------------------------------------
   DELETE CONTENT
-------------------------------------------------- */

async function deleteContent() {

  const id =
    $("editingContentId")
      ?.value;


  if (
    !id ||
    !confirm(
      "Удалить этот контент и все его публикации?"
    )
  ) {
    return;
  }


  const {
    error
  } = await db
    .from("content")
    .delete()
    .eq(
      "id",
      id
    );


  if (error) {

    toast(
      error.message ||
      "Не удалось удалить"
    );

    return;
  }


  closeModal();


  await loadContent();


  renderEverything();


  toast(
    "Удалено"
  );
}


/* --------------------------------------------------
   EVENTS
-------------------------------------------------- */

function bindEvents() {

  $("prevMonth")
    ?.addEventListener(
      "click",
      () => {

        currentMonth =
          new Date(
            currentMonth.getFullYear(),
            currentMonth.getMonth() - 1,
            1
          );

        renderCalendar();
      }
    );


  $("nextMonth")
    ?.addEventListener(
      "click",
      () => {

        currentMonth =
          new Date(
            currentMonth.getFullYear(),
            currentMonth.getMonth() + 1,
            1
          );

        renderCalendar();
      }
    );


  $("todayBtn")
    ?.addEventListener(
      "click",
      () => {

        currentMonth =
          new Date();

        renderCalendar();
      }
    );


  $("addPublicationTop")
    ?.addEventListener(
      "click",
      () =>
        openModal(
          null,
          isoToday()
        )
    );


  $("addContentInline")
    ?.addEventListener(
      "click",
      () =>
        openModal()
    );


  $("addPublication")
    ?.addEventListener(
      "click",
      () =>
        addPublicationEditor()
    );


  $("addPublicationForDay")
    ?.addEventListener(
      "click",
      () => {

        const date =
          selectedDayForNewPublication ||
          isoToday();


        closeDayDetails();


        openModal(
          null,
          date
        );
      }
    );


  $("contentForm")
    ?.addEventListener(
      "submit",
      saveContent
    );


  $("deleteContentBtn")
    ?.addEventListener(
      "click",
      deleteContent
    );


  $("showAllContent")
    ?.addEventListener(
      "click",
      () =>
        switchView(
          "contentView"
        )
    );


  $("contentSearch")
    ?.addEventListener(
      "input",
      renderContent
    );


  $("contentPlatformFilter")
    ?.addEventListener(
      "change",
      renderContent
    );


  $("analyticsPlatform")
    ?.addEventListener(
      "change",
      renderAnalytics
    );


  document
    .querySelectorAll(
      "[data-period]"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () => {

            activePeriod =
              button.dataset.period;


            document
              .querySelectorAll(
                "[data-period]"
              )
              .forEach(
                x =>
                  x.classList.toggle(
                    "active",
                    x === button
                  )
              );


            renderAnalytics();
          }
        );
      }
    );


  document
    .querySelectorAll(
      ".nav-item"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () =>
            switchView(
              button.dataset.view
            )
        );
      }
    );


  document
    .querySelectorAll(
      "[data-close-modal]"
    )
    .forEach(
      element => {

        element.addEventListener(
          "click",
          closeModal
        );
      }
    );


  document
    .querySelectorAll(
      "[data-close-day]"
    )
    .forEach(
      element => {

        element.addEventListener(
          "click",
          closeDayDetails
        );
      }
    );


  document.addEventListener(
    "keydown",
    event => {

      if (
        event.key ===
        "Escape"
      ) {

        closeModal();

        closeDayDetails();
      }
    }
  );
}


/* --------------------------------------------------
   START
-------------------------------------------------- */

boot();
