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

  const [y, m, d] =
    date.split("-").map(Number);

  return `${d} ${shortMonths[m - 1]}`;
}


function formatLongDate(date) {
  if (!date) return "";

  const [y, m, d] =
    date.split("-").map(Number);

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

  const el =
    document.createElement("div");

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


    currentUser =
      session?.user;


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
    .eq(
      "id",
      currentUser.id
    )
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


  members =
    data || [];


  if (
    currentProfile?.telegram_id &&
    !members.some(
      m =>
        m.id ===
        currentProfile.id
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
      x =>
        x.id
    );


  let a = [];


  if (ids.length) {

    const {
      data,
      error
    } = await db
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


    if (error) {
      throw error;
    }


    a =
      data || [];
  }


  contents =
    c || [];

  publications =
    p || [];

  assigneeRows =
    a;
}


/* --------------------------------------------------
   REALTIME
-------------------------------------------------- */

function setupRealtime() {

  realtimeChannels.forEach(
    channel =>
      db.removeChannel(channel)
  );

  realtimeChannels = [];


  [
    "content",
    "publications",
    "publication_assignees"
  ].forEach(table => {

    const channel =
      db
        .channel(
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

            } catch (error) {

              console.warn(
                error
              );
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

  clearInterval(
    memberPoll
  );

  clearInterval(
    plannerPoll
  );


  memberPoll =
    setInterval(
      async () => {

        try {

          await loadMembers();

          renderTeam();

          renderAnalytics();

        } catch (error) {}

      },
      15000
    );


  plannerPoll =
    setInterval(
      async () => {

        try {

          await loadContent();

          renderEverything();

        } catch (error) {

          console.warn(
            error
          );
        }

      },
      15000
    );
}


/* --------------------------------------------------
   SHOW APP
-------------------------------------------------- */

function showApp() {

  $("authScreen")
    ?.classList
    .add("hidden");


  $("app")
    ?.classList
    .remove("hidden");


  switchView(
    "calendarView"
  );
}


/* --------------------------------------------------
   NAVIGATION — ИСПРАВЛЕНО
-------------------------------------------------- */

function switchView(viewId) {

  document
    .querySelectorAll(".view")
    .forEach(view => {

      const isActive =
        view.id === viewId;


      view.classList.toggle(
        "active",
        isActive
      );


      view.classList.toggle(
        "hidden",
        !isActive
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
      "calendar-cell";


    if (
      dateObj.getMonth() !== month
    ) {

      cell.classList.add(
        "muted"
      );
    }


    cell.innerHTML = `
      <div class="day-number${
        date === isoToday()
          ? " today"
          : ""
      }">
        ${dateObj.getDate()}
      </div>
    `;


    cell.addEventListener(
      "click",
      () =>
        openDayDetails(date)
    );


    const list =
      publications
        .filter(
          p =>
            p.publication_date ===
            date
        )
        .sort(
          sortPublication
        );


    /*
      В ЯЧЕЙКЕ КАЛЕНДАРЯ:
      только время + название.
      Никаких платформ, форматов,
      ответственных и статусов.
    */

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
          `pub-chip ${platformClass(
            p.platform
          )}${
            p.status === "done"
              ? " done"
              : ""
          }`;


        chip.innerHTML = `
          ${
            p.publication_time
              ? `<span class="pub-time">${esc(
                  p.publication_time.slice(0, 5)
                )}</span>`
              : ""
          }
          <span class="pub-title">
            ${esc(p.title)}
          </span>
        `;


        chip.addEventListener(
          "click",
          event => {

            event.stopPropagation();

            openModal(
              p.content_id
            );
          }
        );


        cell.appendChild(
          chip
        );
      });


    if (
      list.length > 3
    ) {

      const more =
        document.createElement(
          "button"
        );


      more.type =
        "button";


      more.className =
        "calendar-more";


      more.textContent =
        `+ ещё ${
          list.length - 3
        }`;


      more.addEventListener(
        "click",
        event => {

          event.stopPropagation();

          openDayDetails(
            date
          );
        }
      );


      cell.appendChild(
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

  const box =
    $("upcomingList");


  if (!box) {
    return;
  }


  const now =
    new Date();


  const list =
    publications
      .filter(p => {

        const value =
          `${p.publication_date}T${
            p.publication_time ||
            "23:59:59"
          }`;

        return (
          new Date(value) >= now
        );
      })
      .sort(
        sortPublication
      )
      .slice(0, 6);


  if (!list.length) {

    box.innerHTML = `
      <div class="empty">
        Пока нет запланированных публикаций.
      </div>
    `;

    return;
  }


  box.innerHTML =
    list
      .map(
        p => `
          <button
            type="button"
            class="upcoming-card"
            data-upcoming="${p.id}"
          >

            <div class="date-box">

              <strong>
                ${String(
                  Number(
                    p.publication_date.slice(
                      8,
                      10
                    )
                  )
                ).padStart(
                  2,
                  "0"
                )}
              </strong>

              <span>
                ${shortMonths[
                  Number(
                    p.publication_date.slice(
                      5,
                      7
                    )
                  ) - 1
                ].toUpperCase()}
              </span>

            </div>


            <span
              class="platform-dot ${
                platformClass(
                  p.platform
                )
              }"
            ></span>


            <div class="upcoming-main">

              <div class="upcoming-title">
                ${esc(p.title)}
              </div>

              <div class="upcoming-meta">
                ${esc(p.platform)}
                ·
                ${esc(p.format)}
                ${
                  p.publication_time
                    ? " · " +
                      esc(
                        p.publication_time.slice(
                          0,
                          5
                        )
                      )
                    : ""
                }
              </div>

            </div>


            <span class="chevron">
              ›
            </span>

          </button>
        `
      )
      .join("");


  box
    .querySelectorAll(
      "[data-upcoming]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const publication =
            publications.find(
              x =>
                x.id ===
                button.dataset.upcoming
            );


          if (publication) {

            openModal(
              publication.content_id
            );
          }
        }
      );
    });
}


/* --------------------------------------------------
   CONTENT
-------------------------------------------------- */

function renderContent() {

  const box =
    $("contentList");


  if (!box) {
    return;
  }


  const search =
    (
      $("contentSearch")
        ?.value ||
      ""
    )
      .trim()
      .toLowerCase();


  const platform =
    $("contentPlatformFilter")
      ?.value ||
    "all";


  const filtered =
    contents.filter(
      content => {

        const pubs =
          publications.filter(
            p =>
              p.content_id ===
              content.id
          );


        const text =
          [
            content.title,
            content.description,
            ...pubs.flatMap(
              p => [
                p.title,
                p.platform,
                p.format,
                p.description
              ]
            )
          ]
            .join(" ")
            .toLowerCase();


        return (
          (!search ||
            text.includes(
              search
            )) &&
          (
            platform === "all" ||
            pubs.some(
              p =>
                p.platform ===
                platform
            )
          )
        );
      }
    );


  if (!filtered.length) {

    box.innerHTML = `
      <div class="empty">
        ${
          contents.length
            ? "По выбранным фильтрам ничего не найдено."
            : "Контента пока нет. Нажми «+ Контент», чтобы добавить."
        }
      </div>
    `;

    return;
  }


  box.innerHTML =
    filtered
      .map(content => {

        const pubs =
          publications
            .filter(
              p =>
                p.content_id ===
                content.id
            )
            .sort(
              sortPublication
            );


        return `
          <article
            class="content-card"
            data-content="${content.id}"
          >

            <div class="content-card-head">

              <div class="content-main">

                <div class="content-title">
                  ${esc(content.title)}
                </div>

                ${
                  content.description
                    ? `
                      <div class="content-description">
                        ${esc(
                          content.description
                        )}
                      </div>
                    `
                    : ""
                }

                <div class="content-meta">
                  ${
                    pubs.length
                  }
                  ${
                    pubs.length === 1
                      ? "публикация"
                      : pubs.length < 5
                        ? "публикации"
                        : "публикаций"
                  }
                </div>

              </div>


              <span class="chevron">
                ›
              </span>

            </div>


            <div class="content-publications">

              ${
                pubs
                  .map(
                    p => `
                      <button
                        type="button"
                        class="content-publication"
                        data-publication-id="${p.id}"
                      >

                        <span
                          class="platform-dot ${
                            platformClass(
                              p.platform
                            )
                          }"
                        ></span>


                        <div class="content-pub-main">

                          <div class="content-pub-title">
                            ${esc(p.title)}
                          </div>

                          <div class="content-pub-meta">
                            ${formatDate(
                              p.publication_date
                            )}
                            ${
                              p.publication_time
                                ? " · " +
                                  esc(
                                    p.publication_time.slice(
                                      0,
                                      5
                                    )
                                  )
                                : ""
                            }
                            ·
                            ${esc(
                              p.platform
                            )}
                            ·
                            ${esc(
                              p.format
                            )}
                          </div>

                        </div>


                        <span
                          class="status-pill ${p.status}"
                        >
                          ${statusLabel(
                            p.status
                          )}
                        </span>


                        <span class="chevron">
                          ›
                        </span>

                      </button>
                    `
                  )
                  .join("")
              }

            </div>

          </article>
        `;
      })
      .join("");


  box
    .querySelectorAll(
      "[data-content]"
    )
    .forEach(card => {

      card.addEventListener(
        "click",
        event => {

          if (
            !event.target.closest(
              "[data-publication-id]"
            )
          ) {

            openModal(
              card.dataset.content
            );
          }
        }
      );
    });


  box
    .querySelectorAll(
      "[data-publication-id]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        event => {

          event.stopPropagation();


          const publication =
            publications.find(
              x =>
                x.id ===
                button.dataset.publicationId
            );


          if (publication) {

            openModal(
              publication.content_id
            );
          }
        }
      );
    });
}


/* --------------------------------------------------
   TEAM
-------------------------------------------------- */

function renderTeam() {

  const box =
    $("teamList");


  if (!box) {
    return;
  }


  const count =
    $("teamCount");


  if (count) {

    count.textContent =
      `${members.length} ${
        members.length === 1
          ? "участник"
          : members.length < 5
            ? "участника"
            : "участников"
      }`;
  }


  if (!members.length) {

    box.innerHTML = `
      <div class="empty">
        Участники появятся здесь после входа через Telegram.
      </div>
    `;

    return;
  }


  box.innerHTML =
    members
      .map(member => {

        const name =
          member.telegram_first_name ||
          member.telegram_username ||
          "Участник";


        const initials =
          name
            .slice(0, 2)
            .toUpperCase();


        const avatar =
          member.telegram_photo_url
            ? `
              <div class="avatar">
                <img
                  src="${esc(
                    member.telegram_photo_url
                  )}"
                  alt=""
                >
              </div>
            `
            : `
              <div class="avatar">
                ${esc(initials)}
              </div>
            `;


        return `
          <div class="team-card">

            ${avatar}

            <div>

              <div class="team-name">
                ${esc(name)}
              </div>

              <div class="team-handle">
                ${
                  member.telegram_username
                    ? "@" +
                      esc(
                        member.telegram_username
                      )
                    : "Telegram"
                }
              </div>

            </div>

          </div>
        `;
      })
      .join("");
}


/* --------------------------------------------------
   ANALYTICS
-------------------------------------------------- */

function analyticsPeriodList() {

  const now =
    new Date();


  let from =
    null;


  if (
    activePeriod ===
    "week"
  ) {

    from =
      new Date(
        now.getTime() -
        6 * 86400000
      );
  }


  if (
    activePeriod ===
    "month"
  ) {

    from =
      new Date(
        now.getTime() -
        29 * 86400000
      );
  }


  if (
    activePeriod ===
    "3months"
  ) {

    from =
      new Date(
        now.getTime() -
        89 * 86400000
      );
  }


  const platform =
    $("analyticsPlatform")
      ?.value ||
    "all";


  return publications.filter(
    publication => {

      const date =
        new Date(
          `${publication.publication_date}T12:00:00`
        );


      return (
        (!from ||
          date >= from) &&
        (
          platform === "all" ||
          publication.platform ===
            platform
        )
      );
    }
  );
}


function countBy(
  list,
  key
) {

  return list.reduce(
    (result, item) => {

      const value =
        item[key] ||
        "Не указано";


      result[value] =
        (result[value] || 0) + 1;


      return result;
    },
    {}
  );
}


function renderBars(
  box,
  obj
) {

  if (!box) {
    return;
  }


  const entries =
    Object.entries(obj)
      .sort(
        (a, b) =>
          b[1] - a[1]
      );


  if (!entries.length) {

    box.innerHTML = `
      <div class="empty">
        Нет данных
      </div>
    `;

    return;
  }


  const max =
    entries[0][1];


  box.innerHTML =
    `
      <div class="bars">

        ${
          entries
            .map(
              ([name, number]) => `
                <div class="bar-row">

                  <span>
                    ${esc(name)}
                  </span>

                  <div class="bar-track">

                    <div
                      class="bar-fill"
                      style="width:${Math.max(
                        5,
                        number / max * 100
                      )}%"
                    ></div>

                  </div>

                  <strong>
                    ${number}
                  </strong>

                </div>
              `
            )
            .join("")
        }

      </div>
    `;
}


function renderAnalytics() {

  const total =
    $("statTotal");

  const weekly =
    $("statWeek");


  if (
    !total ||
    !weekly
  ) {
    return;
  }


  const list =
    analyticsPeriodList();


  total.textContent =
    list.length;


  let days =
    activePeriod === "week"
      ? 7
      : activePeriod === "month"
        ? 30
        : activePeriod === "3months"
          ? 90
          : 7;


  if (
    activePeriod ===
      "all" &&
    list.length
  ) {

    const dates =
      list
        .map(
          p =>
            new Date(
              `${p.publication_date}T12:00:00`
            )
        )
        .sort(
          (a, b) =>
            a - b
        );


    days =
      Math.max(
        1,
        Math.round(
          (
            dates[dates.length - 1] -
            dates[0]
          ) /
          86400000
        ) + 1
      );
  }


  weekly.textContent =
    (
      list.length /
      days *
      7
    ).toFixed(1);


  renderBars(
    $("platformStats"),
    countBy(
      list,
      "platform"
    )
  );


  renderBars(
    $("formatStats"),
    countBy(
      list,
      "format"
    )
  );


  const weekdays = {};


  list.forEach(
    publication => {

      const date =
        new Date(
          `${publication.publication_date}T12:00:00`
        );


      const name =
        weekdayNames[
          date.getDay()
        ];


      weekdays[name] =
        (weekdays[name] || 0) + 1;
    }
  );


  renderBars(
    $("weekdayStats"),
    weekdays
  );


  const assignees = {};


  list.forEach(
    publication => {

      publicationAssignees(
        publication.id
      ).forEach(
        member => {

          const name =
            member.telegram_first_name ||
            member.telegram_username ||
            "Участник";


          assignees[name] =
            (assignees[name] || 0) + 1;
        }
      );
    }
  );


  renderBars(
    $("assigneeStats"),
    assignees
  );
}


/* --------------------------------------------------
   RESPONSIBLES
-------------------------------------------------- */

function publicationAssignees(
  publicationId
) {

  return assigneeRows
    .filter(
      row =>
        row.publication_id ===
        publicationId
    )
    .map(
      row =>
        members.find(
          member =>
            member.id ===
            row.user_id
        )
    )
    .filter(Boolean);
}


/* --------------------------------------------------
   DAY DETAILS
-------------------------------------------------- */

function openDayDetails(
  date
) {

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
          p.publication_date ===
          date
      )
      .sort(
        sortPublication
      );


  const eyebrow =
    $("dayModalEyebrow");


  const title =
    $("dayModalTitle");


  const subtitle =
    $("dayModalSubtitle");


  if (eyebrow) {

    eyebrow.textContent =
      formatLongDate(
        date
      );
  }


  if (title) {

    title.textContent =
      `${list.length} ${
        list.length === 1
          ? "публикация"
          : list.length < 5
            ? "публикации"
            : "публикаций"
      }`;
  }


  if (subtitle) {

    subtitle.textContent =
      "Расписание на выбранную дату";
  }


  const listBox =
    $("dayPublicationList");


  if (!listBox) {
    return;
  }


  listBox.innerHTML =
    list.length

      ? list
          .map(publication => {

            const responsible =
              publicationAssignees(
                publication.id
              );


            const responsibleNames =
              responsible.length

                ? responsible
                    .map(
                      member =>
                        member.telegram_first_name ||
                        member.telegram_username ||
                        "Участник"
                    )
                    .join(", ")

                : "Не назначены";


            return `
              <button
                type="button"
                class="day-publication"
                data-day-pub="${publication.id}"
              >

                <div class="day-pub-time">

                  ${
                    publication.publication_time
                      ? esc(
                          publication.publication_time.slice(
                            0,
                            5
                          )
                        )
                      : "—"
                  }

                </div>


                <div class="day-pub-main">

                  <div class="day-pub-title">
                    ${esc(
                      publication.title
                    )}
                  </div>


                  <div class="day-pub-meta">

                    ${esc(
                      publication.platform
                    )}

                    ·

                    ${esc(
                      publication.format
                    )}

                    ·

                    ${statusLabel(
                      publication.status
                    )}

                  </div>


                  <div class="day-pub-assignees">

                    <span>
                      Ответственные:
                    </span>

                    ${esc(
                      responsibleNames
                    )}

                  </div>

                </div>


                <span class="chevron">
                  ›
                </span>

              </button>
            `;
          })
          .join("")

      : `
          <div class="empty">
            На этот день публикаций нет.
          </div>
        `;


  listBox
    .querySelectorAll(
      "[data-day-pub]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const publication =
            publications.find(
              p =>
                p.id ===
                button.dataset.dayPub
            );


          if (publication) {

            closeDayDetails();

            openModal(
              publication.content_id
            );
          }
        }
      );
    });


  modal.classList.remove(
    "hidden"
  );
}


function closeDayDetails() {

  $("dayModal")
    ?.classList
    .add("hidden");
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
          c.id ===
          contentId
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


    deleteButton
      ?.classList
      .remove(
        "hidden"
      );


    const pubs =
      publications
        .filter(
          p =>
            p.content_id ===
            contentId
        )
        .sort(
          sortPublication
        );


    const list =
      $("publicationEditorList");


    if (list) {

      list.innerHTML =
        "";


      pubs.forEach(
        publication =>
          addPublicationEditor(
            publication
          )
      );
    }

  } else {

    if (contentTitle) {

      contentTitle.value =
        "";
    }


    if (description) {

      description.value =
        "";
    }


    deleteButton
      ?.classList
      .add(
        "hidden"
      );


    const list =
      $("publicationEditorList");


    if (list) {

      list.innerHTML =
        "";


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

  $("modal")
    ?.classList
    .add("hidden");
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


  node.dataset.publication =
    "";


  node.dataset.existingId =
    data?.id || "";


  const selected =
    new Set(
      data
        ? assigneeRows
            .filter(
              row =>
                row.publication_id ===
                data.id
            )
            .map(
              row =>
                row.user_id
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

        <select data-field="format">

          <option>Пост</option>

          <option>Рилс</option>

          <option>Сторис</option>

          <option>Видео</option>

          <option>Клип</option>

          <option>Фото</option>

          <option>Другое</option>

        </select>

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
              ? data.publication_time.slice(
                  0,
                  5
                )
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
              ? data.reminder_24h
                ? "checked"
                : ""
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


  const format =
    node.querySelector(
      '[data-field="format"]'
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


  if (format) {

    format.value =
      data?.format ||
      "Пост";
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
                member =>
                  member.id ===
                  id
              )
          )
          .filter(Boolean);


      if (selectedBox) {

        selectedBox.innerHTML =
          chosen.length

            ? chosen
                .map(
                  member => `
                    <span class="assignee-tag">

                      ${esc(
                        member.telegram_first_name ||
                        member.telegram_username ||
                        "Участник"
                      )}

                      <button
                        type="button"
                        data-remove="${member.id}"
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
          member =>
            (
              member.telegram_first_name ||
              ""
            )
              .toLowerCase()
              .includes(search)

            ||

            (
              member.telegram_username ||
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
                      member => `
                        <label class="assignee-option">

                          <input
                            type="checkbox"
                            data-user="${member.id}"
                            ${
                              selected.has(
                                member.id
                              )
                                ? "checked"
                                : ""
                            }
                          >

                          <span>

                            ${esc(
                              member.telegram_first_name ||
                              "Без имени"
                            )}

                            ${
                              member.telegram_username
                                ? " · @" +
                                  esc(
                                    member.telegram_username
                                  )
                                : ""
                            }

                          </span>

                        </label>
                      `
                    )
                    .join("")

                : `
                    <div class="empty">
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


  renderPicker();

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
      (element, index) => {

        element.textContent =
          `Публикация ${
            index + 1
          }`;
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

    const publicationTitle =
      node.querySelector(
        '[data-field="title"]'
      )
        ?.value
        ?.trim();


    const date =
      node.querySelector(
        '[data-field="date"]'
      )
        ?.value;


    if (
      !publicationTitle ||
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
        .eq(
          "id",
          id
        )
        .select()
        .single();


      if (error) {
        throw error;
      }


      saved =
        data;

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


      saved =
        data;
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
              .from(
                "publications"
              )
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
              .from(
                "publications"
              )
              .insert(
                pubPayload
              )
              .select()
              .single();


      if (result.error) {
        throw result.error;
      }


      const publication =
        result.data;


      kept.push(
        publication.id
      );


      const deleteAssignees =
        await db
          .from(
            "publication_assignees"
          )
          .delete()
          .eq(
            "publication_id",
            publication.id
          );


      if (
        deleteAssignees.error
      ) {
        throw deleteAssignees.error;
      }


      const selected =
        [
          ...(
            node._selected ||
            new Set()
          )
        ];


      if (
        selected.length
      ) {

        const insertAssignees =
          await db
            .from(
              "publication_assignees"
            )
            .insert(
              selected.map(
                user_id => ({
                  publication_id:
                    publication.id,
                  user_id
                })
              )
            );


        if (
          insertAssignees.error
        ) {
          throw insertAssignees.error;
        }
      }
    }


    if (id) {

      const removed =
        publications
          .filter(
            p =>
              p.content_id ===
                id &&
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

    console.error(
      error
    );


    toast(
      error?.message ||
      "Ошибка сохранения"
    );


  } finally {

    saving =
      false;


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
                item =>
                  item.classList.toggle(
                    "active",
                    item ===
                      button
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
