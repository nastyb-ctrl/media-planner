/* =========================================================
   MEDIA PLANNER — APP.JS
   ========================================================= */

const SUPABASE_URL = "https://vkvrwayzqrlsfsgjjwpy.supabase.co";
const SUPABASE_KEY = "sb_publishable_-kj7hiC7uou3db2wpwFM_w_jgXQNpnb";

const { createClient } = supabase;

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


/* =========================================================
   TELEGRAM
   ========================================================= */

const tg = window.Telegram?.WebApp;


/* =========================================================
   STATE
   ========================================================= */

let currentUser = null;
let currentProfile = null;
let currentProject = null;

let members = [];
let contents = [];
let publications = [];
let assigneeRows = [];

let currentMonth = new Date();
let activePeriod = "week";

let realtimeChannels = [];

let memberPoll = null;
let plannerPoll = null;

let saving = false;


/* =========================================================
   HELPERS
   ========================================================= */

const $ = id => document.getElementById(id);

const esc = (value = "") =>
  String(value).replace(
    /[&<>"']/g,
    char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char])
  );

const pad = number =>
  String(number).padStart(2, "0");

const isoToday = () => {
  const date = new Date();

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-");
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

const weekNames = [
  "вс",
  "пн",
  "вт",
  "ср",
  "чт",
  "пт",
  "сб"
];


/* =========================================================
   TELEGRAM INIT DATA
   ========================================================= */

function telegramInitData() {
  return tg?.initData || "";
}


/* =========================================================
   TOAST
   ========================================================= */

function toast(text) {
  const old = document.querySelector(".toast");

  if (old) {
    old.remove();
  }

  const element = document.createElement("div");

  element.className = "toast";
  element.textContent = text;

  document.body.appendChild(element);

  setTimeout(() => {
    element.remove();
  }, 2200);
}


/* =========================================================
   AVATAR
   ========================================================= */

function avatarHtml(profile, cls = "") {
  const name =
    profile?.telegram_first_name ||
    profile?.telegram_username ||
    "?";

  const initials =
    name
      .slice(0, 2)
      .toUpperCase();

  if (profile?.telegram_photo_url) {
    return `
      <div class="avatar ${cls}">
        <img
          src="${esc(profile.telegram_photo_url)}"
          alt=""
        >
      </div>
    `;
  }

  return `
    <div class="avatar ${cls}">
      ${esc(initials)}
    </div>
  `;
}


/* =========================================================
   PLATFORM
   ========================================================= */

function platformClass(platform) {
  return String(platform || "")
    .toLowerCase()
    .replace(/[^a-zа-яё]/gi, "");
}


/* =========================================================
   DATE
   ========================================================= */

function formatDate(date) {
  if (!date) {
    return "";
  }

  const parts = date
    .split("-")
    .map(Number);

  const year = parts[0];
  const month = parts[1];
  const day = parts[2];

  return `${day} ${shortMonths[month - 1]}`;
}


function toISO(date) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-");
}


/* =========================================================
   STATUS
   ========================================================= */

function statusLabel(status) {
  if (status === "progress") {
    return "В работе";
  }

  if (status === "done") {
    return "Готово";
  }

  return "Запланировано";
}


/* =========================================================
   PLURAL
   ========================================================= */

function plural(number, one, few, many) {
  const mod10 = number % 10;
  const mod100 = number % 100;

  if (
    mod10 === 1 &&
    mod100 !== 11
  ) {
    return one;
  }

  if (
    mod10 >= 2 &&
    mod10 <= 4 &&
    (
      mod100 < 12 ||
      mod100 > 14
    )
  ) {
    return few;
  }

  return many;
}


/* =========================================================
   PUBLICATION SORT
   ========================================================= */

function sortPublication(a, b) {
  const aa =
    `${a.publication_date}T${a.publication_time || "23:59:59"}`;

  const bb =
    `${b.publication_date}T${b.publication_time || "23:59:59"}`;

  return aa.localeCompare(bb);
}


/* =========================================================
   BOOT
   ========================================================= */

async function boot() {
  try {

    /*
      Telegram Mini App
    */

    tg?.ready();
    tg?.expand();

    if (tg?.setHeaderColor) {
      tg.setHeaderColor("#f7f7f5");
    }

    if (tg?.setBackgroundColor) {
      tg.setBackgroundColor("#f7f7f5");
    }


    /*
      Supabase session
    */

    const {
      data: sessionData
    } = await db.auth.getSession();

    if (!sessionData.session) {

      const {
        error
      } = await db.auth.signInAnonymously();

      if (error) {
        throw error;
      }
    }


    const {
      data: sessionNow
    } = await db.auth.getSession();

    if (!sessionNow?.session?.user) {
      throw new Error(
        "Не удалось создать рабочую сессию."
      );
    }

    currentUser =
      sessionNow.session.user;


    /*
      Telegram validation
    */

    if (!telegramInitData()) {
      throw new Error(
        "Откройте планер через Telegram."
      );
    }


    const authResult =
      await db.functions.invoke(
        "telegram-auth",
        {
          body: {
            initData:
              telegramInitData()
          }
        }
      );

    if (authResult.error) {
      throw authResult.error;
    }


    /*
      Load application
    */

    await loadProfile();

    await ensureProject();

    await loadAll();

    setupRealtime();

    startPolling();

    showApp();

  } catch (error) {

    console.error(
      "BOOT ERROR:",
      error
    );

    showAuthError(
      error?.message ||
      "Не удалось открыть планер."
    );
  }
}


/* =========================================================
   PROFILE
   ========================================================= */

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

  currentProfile = data;
}


/* =========================================================
   PROJECT
   ========================================================= */

async function ensureProject() {

  let {
    data,
    error
  } = await db
    .from("projects")
    .select("*")
    .order(
      "created_at",
      {
        ascending: true
      }
    )
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }


  /*
    If there is no project,
    create default one.
  */

  if (!data) {

    const {
      data: created,
      error: createError
    } = await db.rpc(
      "create_default_project"
    );

    if (createError) {
      throw createError;
    }

    data =
      Array.isArray(created)
        ? created[0]
        : created;
  }


  if (!data) {
    throw new Error(
      "Не найден проект команды."
    );
  }

  currentProject = data;


  /*
    Add current user to project.
  */

  const {
    error: memberError
  } = await db
    .from("project_members")
    .upsert(
      {
        project_id:
          currentProject.id,

        user_id:
          currentUser.id
      },
      {
        onConflict:
          "project_id,user_id",

        ignoreDuplicates:
          true
      }
    );

  if (memberError) {
    console.warn(
      "PROJECT MEMBERSHIP:",
      memberError.message
    );
  }
}


/* =========================================================
   LOAD EVERYTHING
   ========================================================= */

async function loadAll() {

  await Promise.all([
    loadMembers(),
    loadContent()
  ]);

  renderEverything();
}


/* =========================================================
   LOAD ALL TELEGRAM USERS
   ========================================================= */

async function loadMembers() {

  const {
    data,
    error
  } = await db
    .from("profiles")
    .select(
      `
        id,
        telegram_id,
        telegram_username,
        telegram_first_name,
        telegram_photo_url
      `
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

    console.warn(
      "MEMBERS:",
      error.message
    );

    members =
      currentProfile
        ? [currentProfile]
        : [];

    renderTeam();

    return;
  }


  members = data || [];


  /*
    Make sure current user
    is always visible.
  */

  if (
    currentProfile &&
    !members.some(
      member =>
        member.id ===
        currentProfile.id
    )
  ) {
    members.unshift(
      currentProfile
    );
  }


  renderTeam();
}


/* =========================================================
   LOAD CONTENT + PUBLICATIONS
   ========================================================= */

async function loadContent() {

  if (!currentProject) {
    return;
  }


  /*
    Content
  */

  const {
    data: contentData,
    error: contentError
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


  if (contentError) {
    throw contentError;
  }


  /*
    Publications
  */

  const {
    data: publicationData,
    error: publicationError
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


  if (publicationError) {
    throw publicationError;
  }


  /*
    Assignees
  */

  const publicationIds =
    (publicationData || [])
      .map(publication =>
        publication.id
      );


  let assignees = [];


  if (publicationIds.length) {

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
        publicationIds
      );

    if (error) {
      throw error;
    }

    assignees = data || [];
  }


  contents =
    contentData || [];

  publications =
    publicationData || [];

  assigneeRows =
    assignees;
}


/* =========================================================
   REALTIME
   ========================================================= */

function setupRealtime() {

  realtimeChannels.forEach(
    channel =>
      db.removeChannel(channel)
  );

  realtimeChannels = [];


  const tables = [
    "content",
    "publications",
    "publication_assignees"
  ];


  tables.forEach(table => {

    const channel =
      db
        .channel(
          `planner-${table}`
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
                "REALTIME REFRESH:",
                error.message
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


/* =========================================================
   POLLING
   ========================================================= */

function startPolling() {

  clearInterval(
    memberPoll
  );

  clearInterval(
    plannerPoll
  );


  /*
    Team refresh
  */

  memberPoll =
    setInterval(
      async () => {

        try {
          await loadMembers();
        } catch (error) {
          console.warn(
            "TEAM REFRESH:",
            error.message
          );
        }

      },
      15000
    );


  /*
    Planner refresh.
    This makes the shared planner
    update even if Realtime is unavailable.
  */

  plannerPoll =
    setInterval(
      async () => {

        try {

          await loadContent();

          renderEverything();

        } catch (error) {

          console.warn(
            "PLANNER REFRESH:",
            error.message
          );
        }

      },
      15000
    );
}


/* =========================================================
   SHOW APP
   ========================================================= */

function showApp() {

  const authScreen =
    $("authScreen");

  const app =
    $("app");

  if (authScreen) {
    authScreen.classList.add(
      "hidden"
    );
  }

  if (app) {
    app.classList.remove(
      "hidden"
    );
  }

  switchView(
    "calendarView"
  );
}


/* =========================================================
   AUTH ERROR
   ========================================================= */

function showAuthError(message) {

  const card =
    document.querySelector(
      ".auth-card"
    );

  if (!card) {
    return;
  }

  card.innerHTML = `
    <div class="logo-mark">
      !
    </div>

    <h1>
      Не удалось открыть
    </h1>

    <p>
      ${esc(message)}
    </p>
  `;
}


/* =========================================================
   RENDER EVERYTHING
   ========================================================= */

function renderEverything() {

  renderCalendar();

  renderUpcoming();

  renderContent();

  renderTeam();

  renderAnalytics();
}


/* =========================================================
   SWITCH VIEW
   ========================================================= */

function switchView(viewId) {

  document
    .querySelectorAll(".view")
    .forEach(view => {

      view.classList.toggle(
        "active",
        view.id === viewId
      );

    });


  document
    .querySelectorAll(".nav-item")
    .forEach(button => {

      button.classList.toggle(
        "active",
        button.dataset.view ===
        viewId
      );

    });


  /*
    Always return to the top
    when switching screens.
  */

  window.scrollTo({
    top: 0,
    behavior: "instant"
  });
}


/* =========================================================
   CALENDAR
   ========================================================= */

function renderCalendar() {

  const year =
    currentMonth.getFullYear();

  const month =
    currentMonth.getMonth();

  const grid =
    $("calendarGrid");


  if (!grid) {
    return;
  }


  const monthLabel =
    $("monthLabel");


  if (monthLabel) {
    monthLabel.textContent =
      `${monthNames[month]} ${year}`;
  }


  const firstDay =
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


  /*
    Monday = 0
    Sunday = 6
  */

  const previousDays =
    (
      firstDay.getDay() + 6
    ) % 7;


  const totalCells =
    Math.ceil(
      (
        previousDays +
        daysInMonth
      ) / 7
    ) * 7;


  grid.innerHTML = "";


  for (
    let index = 0;
    index < totalCells;
    index++
  ) {

    const day =
      index -
      previousDays +
      1;


    const cell =
      document.createElement(
        "div"
      );


    cell.className =
      "calendar-cell";


    let date;
    let shownDay;


    /*
      Previous month
    */

    if (day < 1) {

      const dateObject =
        new Date(
          year,
          month,
          day
        );

      date =
        toISO(
          dateObject
        );

      shownDay =
        dateObject.getDate();

      cell.classList.add(
        "muted"
      );
    }


    /*
      Next month
    */

    else if (
      day > daysInMonth
    ) {

      const dateObject =
        new Date(
          year,
          month,
          day
        );

      date =
        toISO(
          dateObject
        );

      shownDay =
        dateObject.getDate();

      cell.classList.add(
        "muted"
      );
    }


    /*
      Current month
    */

    else {

      date =
        `${year}-${pad(month + 1)}-${pad(day)}`;

      shownDay =
        day;
    }


    cell.dataset.date =
      date;


    const isToday =
      date ===
      isoToday();


    cell.innerHTML = `
      <div
        class="day-number ${isToday ? "today" : ""}"
      >
        ${shownDay}
      </div>
    `;


    /*
      Clicking anywhere
      on a calendar day opens
      the detailed day screen.
    */

    cell.addEventListener(
      "click",
      () =>
        openDayDetails(date)
    );


    /*
      Publications for this day.
    */

    const dayPublications =
      publications
        .filter(
          publication =>
            publication.publication_date ===
            date
        )
        .sort(
          sortPublication
        );


    /*
      Show maximum 3
      directly in calendar.
    */

    dayPublications
      .slice(0, 3)
      .forEach(publication => {

        const chip =
          document.createElement(
            "button"
          );


        chip.type =
          "button";


        chip.className =
          `pub-chip ${platformClass(
            publication.platform
          )} ${
            publication.status === "done"
              ? "done"
              : ""
          }`;


        chip.innerHTML = `
          ${
            publication.publication_time
              ? `<span class="pub-time">
                  ${esc(
                    publication.publication_time
                      .slice(0, 5)
                  )}
                </span>`
              : ""
          }

          ${esc(
            publication.title
          )}
        `;


        chip.title =
          `${publication.platform} · ${publication.format} · ${publication.title}`;


        /*
          Clicking a publication
          opens its parent content.
        */

        chip.addEventListener(
          "click",
          event => {

            event.stopPropagation();

            openModal(
              publication.content_id
            );
          }
        );


        cell.appendChild(
          chip
        );
      });


    /*
      More publications.
    */

    if (
      dayPublications.length > 3
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
          dayPublications.length - 3
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


/* =========================================================
   OPEN DAY DETAILS
   ========================================================= */

function openDayDetails(date) {

  const publicationsForDay =
    publications
      .filter(
        publication =>
          publication.publication_date ===
          date
      )
      .sort(
        sortPublication
      );


  const dateObject =
    new Date(
      `${date}T12:00:00`
    );


  const eyebrow =
    $("dayModalEyebrow");

  const title =
    $("dayModalTitle");

  const subtitle =
    $("dayModalSubtitle");

  const addButton =
    $("addPublicationForDay");

  const list =
    $("dayPublicationList");


  if (!eyebrow ||
      !title ||
      !subtitle ||
      !addButton ||
      !list) {
    return;
  }


  eyebrow.textContent =
    `${dateObject.getDate()} ${
      shortMonths[
        dateObject.getMonth()
      ]
    } ${
      dateObject.getFullYear()
    }`;


  title.textContent =
    publicationsForDay.length
      ? `${publicationsForDay.length} ${
          plural(
            publicationsForDay.length,
            "публикация",
            "публикации",
            "публикаций"
          )
        }`
      : "Пока пусто";


  subtitle.textContent =
    publicationsForDay.length
      ? "Расписание публикаций на эту дату"
      : "На эту дату ещё ничего не запланировано";


  addButton.dataset.date =
    date;


  /*
    Empty day
  */

  if (!publicationsForDay.length) {

    list.innerHTML = `
      <div class="empty">
        Добавь первую публикацию на этот день.
      </div>
    `;

  }


  /*
    Day with publications
  */

  else {

    list.innerHTML =
      publicationsForDay
        .map(publication => {

          const assignees =
            publicationAssignees(
              publication.id
            );


          const avatars =
            assignees
              .slice(0, 3)
              .map(member =>
                avatarHtml(member)
              )
              .join("");


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
                        publication
                          .publication_time
                          .slice(0, 5)
                      )
                    : "—"
                }
              </div>


              <span
                class="platform-dot ${
                  platformClass(
                    publication.platform
                  )
                }"
              ></span>


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
                </div>

              </div>


              ${
                avatars
                  ? `
                    <div class="assignee-mini">
                      ${avatars}
                    </div>
                  `
                  : ""
              }


              <span class="chevron">
                ›
              </span>

            </button>
          `;
        })
        .join("");


    /*
      Open publication/content.
    */

    list
      .querySelectorAll(
        "[data-day-pub]"
      )
      .forEach(button => {

        button.addEventListener(
          "click",
          () => {

            const publication =
              publications.find(
                item =>
                  item.id ===
                  button.dataset.dayPub
              );


            closeDayDetails();


            if (publication) {

              openModal(
                publication.content_id
              );
            }
          }
        );
      });
  }


  /*
    Open modal.
  */

  openDayModal();
}


/* =========================================================
   DAY MODAL OPEN
   ========================================================= */

function openDayModal() {

  const modal =
    $("dayModal");


  if (!modal) {
    return;
  }


  modal.classList.remove(
    "hidden"
  );


  modal.setAttribute(
    "aria-hidden",
    "false"
  );
}


/* =========================================================
   DAY MODAL CLOSE
   ========================================================= */

function closeDayDetails() {

  const modal =
    $("dayModal");


  if (!modal) {
    return;
  }


  modal.classList.add(
    "hidden"
  );


  modal.setAttribute(
    "aria-hidden",
    "true"
  );
}


/* =========================================================
   PUBLICATION ASSIGNEES
   ========================================================= */

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


/* =========================================================
   UPCOMING
   ========================================================= */

function renderUpcoming() {

  const box =
    $("upcomingList");


  if (!box) {
    return;
  }


  const now =
    new Date();


  const upcoming =
    [...publications]
      .sort(
        sortPublication
      )
      .filter(publication => {

        const dateTime =
          publication.publication_time
            ? new Date(
                `${publication.publication_date}T${publication.publication_time}`
              )
            : new Date(
                `${publication.publication_date}T23:59:00`
              );


        return (
          dateTime >= now &&
          publication.status !== "done"
        );
      })
      .slice(0, 6);


  if (!upcoming.length) {

    box.innerHTML = `
      <div class="empty">
        Пока нет ближайших публикаций.
      </div>
    `;

    return;
  }


  box.innerHTML =
    upcoming
      .map(publication => {

        const assignees =
          publicationAssignees(
            publication.id
          ).slice(0, 3);


        const avatars =
          assignees
            .map(member =>
              avatarHtml(member)
            )
            .join("");


        const month =
          Number(
            publication
              .publication_date
              .slice(5, 7)
          ) - 1;


        return `
          <button
            class="upcoming-card"
            data-pub="${publication.id}"
            type="button"
          >

            <div class="date-box">

              <strong>
                ${publication
                  .publication_date
                  .slice(8)}
              </strong>

              <span>
                ${shortMonths[month]}
              </span>

            </div>


            <span
              class="platform-dot ${
                platformClass(
                  publication.platform
                )
              }"
            ></span>


            <div class="upcoming-main">

              <div class="upcoming-title">
                ${esc(
                  publication.title
                )}
              </div>

              <div class="upcoming-meta">
                ${esc(
                  publication.platform
                )}
                ·
                ${esc(
                  publication.format
                )}

                ${
                  publication.publication_time
                    ? ` · ${esc(
                        publication
                          .publication_time
                          .slice(0, 5)
                      )}`
                    : ""
                }
              </div>

            </div>


            ${
              avatars
                ? `
                  <div class="assignee-mini">
                    ${avatars}
                  </div>
                `
                : ""
            }


            <span class="chevron">
              ›
            </span>

          </button>
        `;
      })
      .join("");


  box
    .querySelectorAll(
      "[data-pub]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const publication =
            publications.find(
              item =>
                item.id ===
                button.dataset.pub
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


/* =========================================================
   CONTENT LIST
   ========================================================= */

function renderContent() {

  const box =
    $("contentList");


  if (!box) {
    return;
  }


  const search =
    (
      $("contentSearch")
        ?.value || ""
    )
      .trim()
      .toLowerCase();


  const platform =
    $("contentPlatformFilter")
      ?.value ||
    "all";


  const filtered =
    contents.filter(content => {

      const contentPublications =
        publications.filter(
          publication =>
            publication.content_id ===
            content.id
        );


      const haystack = [
        content.title || "",
        content.description || "",

        ...contentPublications.flatMap(
          publication => [
            publication.title || "",
            publication.platform || "",
            publication.format || "",
            publication.description || ""
          ]
        )
      ]
        .join(" ")
        .toLowerCase();


      const matchesSearch =
        !search ||
        haystack.includes(
          search
        );


      const matchesPlatform =
        platform === "all" ||
        contentPublications.some(
          publication =>
            publication.platform ===
            platform
        );


      return (
        matchesSearch &&
        matchesPlatform
      );
    });


  if (!filtered.length) {

    const message =
      contents.length
        ? "По выбранным фильтрам ничего не найдено."
        : "Контента пока нет. Нажми «+ Контент», чтобы добавить.";


    box.innerHTML = `
      <div class="empty">
        ${message}
      </div>
    `;

    return;
  }


  box.innerHTML =
    filtered
      .map(content => {

        const contentPublications =
          publications
            .filter(
              publication =>
                publication.content_id ===
                content.id
            )
            .sort(
              sortPublication
            );


        const firstDate =
          contentPublications[0]
            ?.publication_date
            ? formatDate(
                contentPublications[0]
                  .publication_date
              )
            : "Без даты";


        return `
          <article
            class="content-card"
            data-content="${content.id}"
          >

            <div class="content-card-head">

              <div class="content-main">

                <div class="content-title">
                  ${esc(
                    content.title
                  )}
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
                    contentPublications.length
                  }

                  ${
                    plural(
                      contentPublications.length,
                      "публикация",
                      "публикации",
                      "публикаций"
                    )
                  }

                  ·

                  ${esc(
                    firstDate
                  )}

                </div>

              </div>


              <span class="chevron">
                ›
              </span>

            </div>


            <div class="content-publications">

              ${
                contentPublications.length

                  ? contentPublications
                      .map(publication => {

                        const statusClass =
                          publication.status ===
                          "progress"
                            ? "progress"
                            : publication.status ===
                              "done"
                              ? "done"
                              : "";


                        return `
                          <button
                            class="content-publication"
                            data-publication-id="${publication.id}"
                            type="button"
                          >

                            <span
                              class="platform-dot ${
                                platformClass(
                                  publication.platform
                                )
                              }"
                            ></span>


                            <div class="content-pub-main">

                              <div class="content-pub-title">
                                ${esc(
                                  publication.title
                                )}
                              </div>


                              <div class="content-pub-meta">

                                ${esc(
                                  publication.platform
                                )}

                                ·

                                ${esc(
                                  publication.format
                                )}

                                ·

                                ${formatDate(
                                  publication.publication_date
                                )}

                                ${
                                  publication.publication_time
                                    ? ` · ${esc(
                                        publication
                                          .publication_time
                                          .slice(0, 5)
                                      )}`
                                    : ""
                                }

                              </div>

                            </div>


                            <span
                              class="status-pill ${statusClass}"
                            >
                              ${statusLabel(
                                publication.status
                              )}
                            </span>


                            <span class="chevron">
                              ›
                            </span>

                          </button>
                        `;
                      })
                      .join("")

                  : `
                    <div
                      class="empty"
                      style="padding:18px"
                    >
                      Публикаций пока нет.
                    </div>
                  `
              }

            </div>

          </article>
        `;
      })
      .join("");


  /*
    Click on content card.
  */

  box
    .querySelectorAll(
      "[data-content]"
    )
    .forEach(card => {

      card.addEventListener(
        "click",
        event => {

          if (
            event.target.closest(
              "[data-publication-id]"
            )
          ) {
            return;
          }


          openModal(
            card.dataset.content
          );
        }
      );
    });


  /*
    Click on specific publication.
  */

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
              item =>
                item.id ===
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


/* =========================================================
   TEAM
   ========================================================= */

function renderTeam() {

  const box =
    $("teamList");


  const count =
    $("teamCount");


  if (!box) {
    return;
  }


  if (count) {

    count.textContent =
      `${members.length} ${
        plural(
          members.length,
          "участник",
          "участника",
          "участников"
        )
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
          "Без имени";


        const handle =
          member.telegram_username
            ? `@${esc(
                member.telegram_username
              )}`
            : "Telegram";


        return `
          <div class="team-card">

            ${avatarHtml(member)}

            <div>

              <div class="team-name">
                ${esc(name)}
              </div>

              <div class="team-handle">
                ${handle}
              </div>

            </div>

          </div>
        `;
      })
      .join("");
}


/* =========================================================
   ANALYTICS
   ========================================================= */

function renderAnalytics() {

  const list =
    analyticsPeriod();


  const total =
    $("statTotal");


  if (total) {
    total.textContent =
      list.length;
  }


  const days =
    activePeriod === "week"
      ? 7
      : activePeriod === "month"
        ? 30
        : activePeriod === "3months"
          ? 90
          : Math.max(
              1,
              daysBetween(
                minDate(list),
                maxDate(list)
              ) + 1
            );


  const average =
    $("statWeek");


  if (average) {

    average.textContent =
      (
        (list.length / days) *
        7
      ).toFixed(1);
  }


  /*
    Social networks
  */

  renderBars(
    "platformStats",
    countBy(
      list,
      "platform"
    )
  );


  /*
    Formats
  */

  renderBars(
    "formatStats",
    countBy(
      list,
      "format"
    )
  );


  /*
    Weekdays
  */

  const weekdays = {};


  list.forEach(publication => {

    const date =
      new Date(
        `${publication.publication_date}T12:00:00`
      );


    const name =
      [
        "Вс",
        "Пн",
        "Вт",
        "Ср",
        "Чт",
        "Пт",
        "Сб"
      ][date.getDay()];


    weekdays[name] =
      (
        weekdays[name] ||
        0
      ) + 1;
  });


  renderBars(
    "weekdayStats",
    weekdays
  );


  /*
    Responsible workload
  */

  const workload = {};


  list.forEach(publication => {

    publicationAssignees(
      publication.id
    ).forEach(member => {

      const name =
        member.telegram_first_name ||
        member.telegram_username ||
        "Участник";


      workload[name] =
        (
          workload[name] ||
          0
        ) + 1;
    });
  });


  renderBars(
    "assigneeStats",
    workload
  );
}


/* =========================================================
   ANALYTICS PERIOD
   ========================================================= */

function analyticsPeriod() {

  const now =
    new Date();


  let from = null;


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


      const inPeriod =
        !from ||
        date >= from;


      const inPlatform =
        platform === "all" ||
        publication.platform ===
        platform;


      return (
        inPeriod &&
        inPlatform
      );
    }
  );
}


/* =========================================================
   COUNT BY
   ========================================================= */

function countBy(
  list,
  key
) {

  return list.reduce(
    (result, item) => {

      const value =
        item[key] ||
        "Другое";


      result[value] =
        (
          result[value] ||
          0
        ) + 1;


      return result;

    },
    {}
  );
}


/* =========================================================
   ANALYTICS BARS
   ========================================================= */

function renderBars(
  id,
  object
) {

  const box =
    $(id);


  if (!box) {
    return;
  }


  const entries =
    Object.entries(
      object
    ).sort(
      (a, b) =>
        b[1] - a[1]
    );


  const max =
    entries[0]?.[1] ||
    1;


  if (!entries.length) {

    box.innerHTML = `
      <div
        class="empty"
        style="padding:18px;margin-top:12px"
      >
        Нет данных
      </div>
    `;

    return;
  }


  box.innerHTML = `
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
                    style="
                      width:${Math.max(
                        4,
                        number / max * 100
                      )}%
                    "
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


/* =========================================================
   DATE HELPERS
   ========================================================= */

function minDate(list) {

  if (!list.length) {
    return isoToday();
  }


  return list.reduce(
    (result, item) =>
      result <
      item.publication_date
        ? result
        : item.publication_date,

    list[0].publication_date
  );
}


function maxDate(list) {

  if (!list.length) {
    return isoToday();
  }


  return list.reduce(
    (result, item) =>
      result >
      item.publication_date
        ? result
        : item.publication_date,

    list[0].publication_date
  );
}


function daysBetween(
  start,
  end
) {

  return Math.round(
    (
      new Date(end) -
      new Date(start)
    ) /
    86400000
  );
}


/* =========================================================
   OPEN CONTENT MODAL
   ========================================================= */

function openModal(
  contentId = null,
  presetDate = null
) {

  const modal =
    $("modal");


  if (!modal) {
    return;
  }


  const contentIdInput =
    $("editingContentId");


  const title =
    $("modalTitle");


  const deleteButton =
    $("deleteContentBtn");


  const contentTitle =
    $("contentTitle");


  const contentDescription =
    $("contentDescription");


  const editorList =
    $("publicationEditorList");


  if (
    !contentIdInput ||
    !title ||
    !deleteButton ||
    !contentTitle ||
    !contentDescription ||
    !editorList
  ) {
    return;
  }


  /*
    Reset editor
  */

  contentIdInput.value =
    contentId || "";


  title.textContent =
    contentId
      ? "Редактировать контент"
      : "Новый контент";


  deleteButton.classList.toggle(
    "hidden",
    !contentId
  );


  contentTitle.value =
    "";


  contentDescription.value =
    "";


  editorList.innerHTML =
    "";


  /*
    Existing content
  */

  if (contentId) {

    const content =
      contents.find(
        item =>
          item.id ===
          contentId
      );


    if (content) {

      contentTitle.value =
        content.title ||
        "";


      contentDescription.value =
        content.description ||
        "";
    }


    publications
      .filter(
        publication =>
          publication.content_id ===
          contentId
      )
      .sort(
        sortPublication
      )
      .forEach(
        publication =>
          addPublicationEditor(
            publication
          )
      );


    /*
      Safety:
      if content has no publications,
      create one.
    */

    if (
      !document.querySelector(
        "[data-publication]"
      )
    ) {

      addPublicationEditor(
        null,
        presetDate
      );
    }

  }


  /*
    New content
  */

  else {

    addPublicationEditor(
      null,
      presetDate
    );
  }


  modal.classList.remove(
    "hidden"
  );


  modal.setAttribute(
    "aria-hidden",
    "false"
  );
}


/* =========================================================
   CLOSE CONTENT MODAL
   ========================================================= */

function closeModal() {

  const modal =
    $("modal");


  if (!modal) {
    return;
  }


  modal.classList.add(
    "hidden"
  );


  modal.setAttribute(
    "aria-hidden",
    "true"
  );
}


/* =========================================================
   ADD PUBLICATION EDITOR
   ========================================================= */

function addPublicationEditor(
  data = null,
  presetDate = null
) {

  const template =
    $("publicationTemplate");


  const editorList =
    $("publicationEditorList");


  if (
    !template ||
    !editorList
  ) {
    return;
  }


  const node =
    template.content
      .firstElementChild
      .cloneNode(true);


  node.dataset.existingId =
    data?.id ||
    "";


  /*
    Default values
  */

  const defaults = {
    title: "",
    platform: "Telegram",
    format: "Пост",
    date:
      presetDate ||
      data?.publication_date ||
      isoToday(),
    time: "",
    status: "planned",
    link: "",
    description: ""
  };


  const fields =
    node.querySelectorAll(
      "[data-field]"
    );


  fields.forEach(field => {

    const fieldName =
      field.dataset.field;


    field.value =
      data?.[fieldName] ??
      defaults[fieldName] ??
      "";
  });


  /*
    Reminder values
  */

  const reminder24 =
    node.querySelector(
      '[data-reminder="24h"]'
    );

  const reminder3 =
    node.querySelector(
      '[data-reminder="3h"]'
    );

  const reminder1 =
    node.querySelector(
      '[data-reminder="1h"]'
    );


  if (reminder24) {

    reminder24.checked =
      data
        ? !!data.reminder_24h
        : true;
  }


  if (reminder3) {

    reminder3.checked =
      data
        ? !!data.reminder_3h
        : false;
  }


  if (reminder1) {

    reminder1.checked =
      data
        ? !!data.reminder_1h
        : false;
  }


  /*
    Selected responsible users
  */

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


  /*
    Responsible picker
  */

  const renderPicker =
    () => {

      const searchInput =
        node.querySelector(
          "[data-search]"
        );


      const options =
        node.querySelector(
          "[data-options]"
        );


      const selectedBox =
        node.querySelector(
          "[data-selected]"
        );


      if (
        !searchInput ||
        !options ||
        !selectedBox
      ) {
        return;
      }


      const search =
        (
          searchInput.value ||
          ""
        )
          .toLowerCase()
          .trim();


      const filtered =
        members.filter(
          member => {

            const name =
              (
                member
                  .telegram_first_name ||
                ""
              ).toLowerCase();


            const username =
              (
                member
                  .telegram_username ||
                ""
              ).toLowerCase();


            return (
              name.includes(search) ||
              username.includes(search)
            );
          }
        );


      /*
        Options
      */

      options.innerHTML =
        filtered
          .map(member => {

            const checked =
              selected.has(
                member.id
              )
                ? "checked"
                : "";


            return `
              <label
                class="assignee-option"
              >

                <input
                  type="checkbox"
                  data-user="${member.id}"
                  ${checked}
                >

                <span>
                  ${esc(
                    member
                      .telegram_first_name ||
                    "Без имени"
                  )}

                  ${
                    member
                      .telegram_username
                      ? ` · @${esc(
                          member
                            .telegram_username
                        )}`
                      : ""
                  }
                </span>

              </label>
            `;
          })
          .join("");


      /*
        Checkbox events
      */

      options
        .querySelectorAll(
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


      /*
        Selected tags
      */

      selectedBox.innerHTML =
        [...selected]
          .map(
            userId =>
              members.find(
                member =>
                  member.id ===
                  userId
              )
          )
          .filter(Boolean)
          .map(
            member => `
              <span
                class="assignee-tag"
              >

                ${esc(
                  member
                    .telegram_first_name ||
                  "Участник"
                )}

                <button
                  type="button"
                  data-remove="${member.id}"
                  aria-label="Удалить ответственного"
                >
                  ×
                </button>

              </span>
            `
          )
          .join("");


      /*
        Remove selected user
      */

      selectedBox
        .querySelectorAll(
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


  /*
    Search
  */

  const searchInput =
    node.querySelector(
      "[data-search]"
    );


  if (searchInput) {

    searchInput.addEventListener(
      "input",
      renderPicker
    );
  }


  /*
    Remove publication
  */

  const removeButton =
    node.querySelector(
      ".remove-publication"
    );


  if (removeButton) {

    removeButton.addEventListener(
      "click",
      () => {

        const allEditors =
          document.querySelectorAll(
            "[data-publication]"
          );


        if (
          allEditors.length <= 1
        ) {

          toast(
            "Должна остаться хотя бы одна публикация."
          );

          return;
        }


        node.remove();

        renumberEditors();
      }
    );
  }


  /*
    Render picker before insertion
    so state is ready.
  */

  editorList.appendChild(
    node
  );


  renderPicker();

  renumberEditors();
}


/* =========================================================
   RENUMBER PUBLICATIONS
   ========================================================= */

function renumberEditors() {

  document
    .querySelectorAll(
      "[data-publication] .pub-number"
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


/* =========================================================
   SAVE CONTENT
   ========================================================= */

async function saveContent(event) {

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
      .trim() ||
    "";


  if (!title) {

    toast(
      "Введите название контента."
    );

    $("contentTitle")?.focus();

    return;
  }


  const nodes =
    [
      ...document.querySelectorAll(
        "[data-publication]"
      )
    ];


  if (!nodes.length) {

    toast(
      "Добавьте хотя бы одну публикацию."
    );

    return;
  }


  /*
    Validate publications.
  */

  for (
    const node of nodes
  ) {

    const pubTitle =
      node
        .querySelector(
          '[data-field="title"]'
        )
        ?.value
        .trim() ||
      "";


    const pubDate =
      node
        .querySelector(
          '[data-field="date"]'
        )
        ?.value ||
      "";


    if (
      !pubTitle ||
      !pubDate
    ) {

      toast(
        "Заполните название и дату публикации."
      );

      return;
    }
  }


  saving = true;


  const submit =
    document.querySelector(
      '#contentForm button[type="submit"]'
    );


  if (submit) {

    submit.disabled =
      true;

    submit.textContent =
      "Сохраняем…";
  }


  try {

    const contentId =
      $("editingContentId")
        ?.value ||
      null;


    let savedContent;


    /*
      Existing content
    */

    if (contentId) {

      const {
        data,
        error
      } = await db
        .from("content")
        .update({
          title,
          description:
            $("contentDescription")
              ?.value
              .trim() ||
            null
        })
        .eq(
          "id",
          contentId
        )
        .select()
        .single();


      if (error) {
        throw error;
      }


      savedContent =
        data;
    }


    /*
      New content
    */

    else {

      const {
        data,
        error
      } = await db
        .from("content")
        .insert({
          project_id:
            currentProject.id,

          title,

          description:
            $("contentDescription")
              ?.value
              .trim() ||
            null,

          created_by:
            currentUser.id
        })
        .select()
        .single();


      if (error) {
        throw error;
      }


      savedContent =
        data;
    }


    /*
      Save publications
    */

    const keptIds = [];


    for (
      const node of nodes
    ) {

      const get =
        field =>
          node
            .querySelector(
              `[data-field="${field}"]`
            )
            ?.value ||
          "";


      const payload = {

        content_id:
          savedContent.id,

        project_id:
          currentProject.id,

        title:
          get("title").trim(),

        platform:
          get("platform"),

        format:
          get("format"),

        publication_date:
          get("date"),

        publication_time:
          get("time") ||
          null,

        status:
          get("status") ||
          "planned",

        link:
          get("link").trim() ||
          null,

        description:
          get("description").trim() ||
          null,

        reminder_24h:
          node.querySelector(
            '[data-reminder="24h"]'
          )?.checked ??
          true,

        reminder_3h:
          node.querySelector(
            '[data-reminder="3h"]'
          )?.checked ??
          false,

        reminder_1h:
          node.querySelector(
            '[data-reminder="1h"]'
          )?.checked ??
          false
      };


      const existingId =
        node.dataset.existingId;


      let publication;
      let error;


      /*
        Update
      */

      if (existingId) {

        ({
          data: publication,
          error
        } = await db
          .from("publications")
          .update(payload)
          .eq(
            "id",
            existingId
          )
          .select()
          .single());
      }


      /*
        Insert
      */

      else {

        ({
          data: publication,
          error
        } = await db
          .from("publications")
          .insert(payload)
          .select()
          .single());
      }


      if (error) {
        throw error;
      }


      keptIds.push(
        publication.id
      );


      /*
        Save responsible users
      */

      const selected =
        [
          ...(
            node._selected ||
            new Set()
          )
        ];


      /*
        Clear previous assignees.
      */

      const {
        error: deleteAssigneeError
      } = await db
        .from(
          "publication_assignees"
        )
        .delete()
        .eq(
          "publication_id",
          publication.id
        );


      if (
        deleteAssigneeError
      ) {
        throw deleteAssigneeError;
      }


      /*
        Insert selected users.
      */

      if (selected.length) {

        const rows =
          selected.map(
            userId => ({
              publication_id:
                publication.id,

              user_id:
                userId
            })
          );


        const {
          error:
            insertAssigneeError
        } = await db
          .from(
            "publication_assignees"
          )
          .insert(rows);


        if (
          insertAssigneeError
        ) {
          throw insertAssigneeError;
        }
      }
    }


    /*
      Delete publications removed
      from the editor.
    */

    if (contentId) {

      const removed =
        publications
          .filter(
            publication =>
              publication.content_id ===
              contentId &&
              !keptIds.includes(
                publication.id
              )
          )
          .map(
            publication =>
              publication.id
          );


      if (removed.length) {

        const {
          error
        } = await db
          .from("publications")
          .delete()
          .in(
            "id",
            removed
          );


        if (error) {
          throw error;
        }
      }
    }


    /*
      Finish
    */

    closeModal();

    await loadContent();

    renderEverything();

    toast(
      "Сохранено"
    );

  } catch (error) {

    console.error(
      "SAVE ERROR:",
      error
    );

    toast(
      error?.message ||
      "Не удалось сохранить."
    );

  } finally {

    saving = false;


    if (submit) {

      submit.disabled =
        false;

      submit.textContent =
        "Сохранить";
    }
  }
}


/* =========================================================
   DELETE CONTENT
   ========================================================= */

async function deleteContent() {

  const contentId =
    $("editingContentId")
      ?.value ||
    "";


  if (!contentId) {
    return;
  }


  const confirmed =
    window.confirm(
      "Удалить этот контент и все его публикации?"
    );


  if (!confirmed) {
    return;
  }


  try {

    const {
      error
    } = await db
      .from("content")
      .delete()
      .eq(
        "id",
        contentId
      );


    if (error) {
      throw error;
    }


    closeModal();

    await loadContent();

    renderEverything();

    toast(
      "Контент удалён."
    );

  } catch (error) {

    console.error(
      "DELETE ERROR:",
      error
    );

    toast(
      "Не удалось удалить контент."
    );
  }
}


/* =========================================================
   CALENDAR CONTROLS
   ========================================================= */

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


/* =========================================================
   ADD PUBLICATION FROM CALENDAR
   ========================================================= */

$("addPublicationTop")
  ?.addEventListener(
    "click",
    () => {

      openModal(
        null,
        isoToday()
      );
    }
  );


/* =========================================================
   ADD CONTENT
   ========================================================= */

$("addContentInline")
  ?.addEventListener(
    "click",
    () => {

      openModal();
    }
  );


/* =========================================================
   ADD PUBLICATION INSIDE EDITOR
   ========================================================= */

$("addPublication")
  ?.addEventListener(
    "click",
    () => {

      addPublicationEditor();
    }
  );


/* =========================================================
   ADD PUBLICATION FOR SELECTED DATE
   ========================================================= */

$("addPublicationForDay")
  ?.addEventListener(
    "click",
    () => {

      const date =
        $("addPublicationForDay")
          ?.dataset
          .date ||
        isoToday();


      closeDayDetails();


      openModal(
        null,
        date
      );
    }
  );


/* =========================================================
   CONTENT FORM
   ========================================================= */

$("contentForm")
  ?.addEventListener(
    "submit",
    event => {

      saveContent(
        event
      ).catch(error => {

        console.error(
          "FORM ERROR:",
          error
        );

        saving = false;

        const submit =
          document.querySelector(
            '#contentForm button[type="submit"]'
          );


        if (submit) {

          submit.disabled =
            false;

          submit.textContent =
            "Сохранить";
        }


        toast(
          error?.message ||
          "Ошибка сохранения."
        );
      });
    }
  );


/* =========================================================
   DELETE CONTENT
   ========================================================= */

$("deleteContentBtn")
  ?.addEventListener(
    "click",
    () => {

      deleteContent();
    }
  );


/* =========================================================
   CLOSE CONTENT MODAL
   ========================================================= */

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


/* =========================================================
   CLOSE DAY MODAL
   ========================================================= */

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


/* =========================================================
   NAVIGATION
   ========================================================= */

document
  .querySelectorAll(
    ".nav-item"
  )
  .forEach(
    button => {

      button.addEventListener(
        "click",
        () => {

          switchView(
            button.dataset.view
          );
        }
      );
    }
  );


/* =========================================================
   SHOW ALL CONTENT
   ========================================================= */

$("showAllContent")
  ?.addEventListener(
    "click",
    () => {

      switchView(
        "contentView"
      );
    }
  );


/* =========================================================
   ANALYTICS FILTERS
   ========================================================= */

document
  .querySelectorAll(
    ".filter-btn"
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
              ".filter-btn"
            )
            .forEach(
              item => {

                item.classList.toggle(
                  "active",
                  item === button
                );
              }
            );


          renderAnalytics();
        }
      );
    }
  );


$("analyticsPlatform")
  ?.addEventListener(
    "change",
    renderAnalytics
  );


/* =========================================================
   CONTENT FILTERS
   ========================================================= */

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


/* =========================================================
   ESCAPE
   ========================================================= */

document.addEventListener(
  "keydown",
  event => {

    if (
      event.key !==
      "Escape"
    ) {
      return;
    }


    closeModal();

    closeDayDetails();
  }
);


/* =========================================================
   START
   ========================================================= */

boot();
