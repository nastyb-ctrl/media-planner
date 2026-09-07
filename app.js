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

const tg = window.Telegram?.WebApp;

let currentUser = null;
let currentProfile = null;
let currentProject = null;

let members = [];
let contents = [];
let publications = [];
let assigneeRows = [];

let dayStyles = {};

let currentMonth = new Date();

let activePeriod = "week";

let realtimeChannels = [];

let memberPoll = null;


const $ = id =>
  document.getElementById(id);


const esc = (value = "") =>
  String(value).replace(
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


const pad = n =>
  String(n).padStart(2, "0");


const isoToday = () => {

  const d = new Date();

  return `${d.getFullYear()}-${pad(
    d.getMonth() + 1
  )}-${pad(d.getDate())}`;

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


function telegramInitData() {

  return tg?.initData || "";

}


function toast(text) {

  const old =
    document.querySelector(".toast");

  if (old) {
    old.remove();
  }


  const el =
    document.createElement("div");

  el.className = "toast";

  el.textContent = text;

  document.body.appendChild(el);


  setTimeout(
    () => el.remove(),
    2200
  );

}


function avatarHtml(
  profile,
  cls = ""
) {

  const name =
    profile?.telegram_first_name ||
    profile?.telegram_username ||
    "?";


  const initials =
    name
      .slice(0, 2)
      .toUpperCase();


  if (
    profile?.telegram_photo_url
  ) {

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


function platformClass(
  platform
) {

  return String(platform || "")
    .toLowerCase()
    .replace(
      /[^a-zа-яё]/gi,
      ""
    );

}


function formatDate(
  date
) {

  if (!date) {
    return "";
  }


  const [
    y,
    m,
    d
  ] =
    date
      .split("-")
      .map(Number);


  return `${d} ${shortMonths[m - 1]}`;

}


/* =========================================================
   START
========================================================= */

async function boot() {

  try {

    tg?.ready();
    tg?.expand();


    if (tg?.setHeaderColor) {
      tg.setHeaderColor(
        "#f6f6f3"
      );
    }


    if (tg?.setBackgroundColor) {
      tg.setBackgroundColor(
        "#f6f6f3"
      );
    }


    const {
      data: sessionData
    } =
      await db.auth.getSession();


    if (!sessionData.session) {

      const {
        error
      } =
        await db.auth
          .signInAnonymously();

      if (error) {
        throw error;
      }

    }


    const {
      data: sessionNow
    } =
      await db.auth.getSession();


    currentUser =
      sessionNow.session.user;


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


    await loadProfile();

    await ensureProject();

    await loadAll();

    setupRealtime();

    startMemberPolling();

    showApp();

  } catch (err) {

    console.error(err);

    showAuthError(
      err?.message ||
      "Не удалось открыть планер"
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
  } =
    await db
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
    data;

}


/* =========================================================
   PROJECT
========================================================= */

async function ensureProject() {

  let {
    data,
    error
  } =
    await db
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


  if (!data) {

    const {
      data: created,
      error: createError
    } =
      await db.rpc(
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


  currentProject =
    data;


  const {
    error: memberError
  } =
    await db
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
      "project membership:",
      memberError.message
    );

  }

}


/* =========================================================
   LOAD ALL
========================================================= */

async function loadAll() {

  await Promise.all([
    loadMembers(),
    loadContent(),
    loadDayStyles()
  ]);


  renderEverything();

}


/* =========================================================
   TEAM
========================================================= */

async function loadMembers() {

  const {
    data,
    error
  } =
    await db
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

    console.warn(
      "members:",
      error.message
    );

    members = [];

    return;
  }


  members =
    data || [];


  renderTeam();

}


/* =========================================================
   CONTENT
========================================================= */

async function loadContent() {

  if (!currentProject) {
    return;
  }


  const {
    data: c,
    error: ce
  } =
    await db
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
  } =
    await db
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
      error: ae
    } =
      await db
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


    if (ae) {
      throw ae;
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


/* =========================================================
   DAY COLORS
========================================================= */

async function loadDayStyles() {

  if (!currentProject) {
    return;
  }


  const {
    data,
    error
  } =
    await db
      .from(
        "calendar_day_styles"
      )
      .select(
        "date,color"
      )
      .eq(
        "project_id",
        currentProject.id
      );


  if (error) {

    console.warn(
      "day styles:",
      error.message
    );

    dayStyles = {};

    return;
  }


  dayStyles =
    Object.fromEntries(
      (data || []).map(
        x => [
          x.date,
          x.color
        ]
      )
    );

}


async function saveDayColor(
  date,
  color
) {

  if (!currentProject) {
    return;
  }


  if (
    color === "white"
  ) {

    const {
      error
    } =
      await db
        .from(
          "calendar_day_styles"
        )
        .delete()
        .eq(
          "project_id",
          currentProject.id
        )
        .eq(
          "date",
          date
        );


    if (error) {
      throw error;
    }


    delete dayStyles[date];

  } else {

    const {
      data,
      error
    } =
      await db
        .from(
          "calendar_day_styles"
        )
        .upsert(
          {
            project_id:
              currentProject.id,

            date,

            color
          },
          {
            onConflict:
              "project_id,date"
          }
        )
        .select(
          "date,color"
        )
        .single();


    if (error) {
      throw error;
    }


    dayStyles[date] =
      data.color;

  }


  renderCalendar();

}


function dayColorValue(
  date
) {

  return (
    dayStyles[date] ||
    "white"
  );

}


/* =========================================================
   DAY EDITOR
========================================================= */

function openDayEditor(
  date
) {

  const dayPubs =
    publications
      .filter(
        p =>
          p.publication_date === date
      )
      .sort(
        sortPublication
      );


  if (dayPubs.length) {

    openModal(
      dayPubs[0].content_id
    );

  } else {

    openModal(
      null,
      date
    );

  }

}


function showDayPalette(
  cell,
  date
) {

  document
    .querySelectorAll(
      ".day-palette"
    )
    .forEach(
      x => x.remove()
    );


  const palette =
    document.createElement(
      "div"
    );


  palette.className =
    "day-palette";


  palette.innerHTML = `

    <button
      type="button"
      data-color="white"
      aria-label="Белый"
      title="Белый"
    ></button>

    <button
      type="button"
      data-color="yellow"
      aria-label="Бледно-жёлтый"
      title="Бледно-жёлтый"
    ></button>

    <button
      type="button"
      data-color="purple"
      aria-label="Бледно-фиолетовый"
      title="Бледно-фиолетовый"
    ></button>

    <button
      type="button"
      data-color="green"
      aria-label="Бледно-зелёный"
      title="Бледно-зелёный"
    ></button>

  `;


  cell.appendChild(
    palette
  );


  palette
    .querySelectorAll(
      "[data-color]"
    )
    .forEach(
      btn => {

        btn.addEventListener(
          "click",
          async e => {

            e.stopPropagation();


            try {

              await saveDayColor(
                date,
                btn.dataset.color
              );


              palette.remove();

            } catch (err) {

              console.error(err);

              toast(
                err.message ||
                "Не удалось изменить цвет"
              );

            }

          }
        );

      }
    );

}


/* =========================================================
   REALTIME
========================================================= */

function setupRealtime() {

  realtimeChannels
    .forEach(
      ch =>
        db.removeChannel(ch)
    );


  realtimeChannels = [];


  const tables = [
    "content",
    "publications",
    "publication_assignees"
  ];


  tables.forEach(
    table => {

      const ch =
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

              await loadContent();

              renderEverything();

            }
          )
          .subscribe();


      realtimeChannels.push(
        ch
      );

    }
  );

}


/* =========================================================
   TEAM AUTO REFRESH
========================================================= */

function startMemberPolling() {

  clearInterval(
    memberPoll
  );


  memberPoll =
    setInterval(
      async () => {

        await loadMembers();

      },
      15000
    );

}


/* =========================================================
   APP
========================================================= */

function showApp() {

  $("authScreen")
    .classList
    .add("hidden");


  $("app")
    .classList
    .remove("hidden");


  switchView(
    "calendarView"
  );

}


function showAuthError(
  message
) {

  const card =
    document.querySelector(
      ".auth-card"
    );


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
   RENDER
========================================================= */

function renderEverything() {

  renderCalendar();

  renderUpcoming();

  renderContent();

  renderTeam();

  renderAnalytics();

}


function switchView(
  viewId
) {

  document
    .querySelectorAll(
      ".view"
    )
    .forEach(
      v =>
        v.classList.toggle(
          "active",
          v.id === viewId
        )
    );


  document
    .querySelectorAll(
      ".nav-item"
    )
    .forEach(
      b =>
        b.classList.toggle(
          "active",
          b.dataset.view === viewId
        )
    );

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


  $("monthLabel").textContent =
    `${monthNames[month]} ${year}`;


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


  const prevDays =
    (
      first.getDay() +
      6
    ) % 7;


  const totalCells =
    Math.ceil(
      (
        prevDays +
        daysInMonth
      ) / 7
    ) * 7;


  grid.innerHTML =
    "";


  for (
    let i = 0;
    i < totalCells;
    i++
  ) {

    const day =
      i -
      prevDays +
      1;


    const cell =
      document.createElement(
        "div"
      );


    cell.className =
      "calendar-cell";


    let date;

    let shownDay;


    if (day < 1) {

      const d =
        new Date(
          year,
          month,
          day
        );


      date =
        toISO(d);


      shownDay =
        d.getDate();


      cell.classList.add(
        "muted"
      );

    } else if (
      day > daysInMonth
    ) {

      const d =
        new Date(
          year,
          month,
          day
        );


      date =
        toISO(d);


      shownDay =
        d.getDate();


      cell.classList.add(
        "muted"
      );

    } else {

      date =
        `${year}-${pad(
          month + 1
        )}-${pad(day)}`;


      shownDay =
        day;

    }


    const color =
      dayColorValue(
        date
      );


    if (
      color !== "white"
    ) {

      cell.classList.add(
        `day-color-${color}`
      );

    }


    cell.dataset.date =
      date;


    const isToday =
      date ===
      isoToday();


    cell.innerHTML = `

      <div
        class="day-number ${
          isToday
            ? "today"
            : ""
        }"
      >
        ${shownDay}
      </div>

      <button
        class="day-palette-trigger"
        type="button"
        aria-label="Цвет ячейки"
        title="Цвет ячейки"
      >
        •
      </button>

    `;


    cell.addEventListener(
      "click",
      e => {

        if (
          e.target.closest(
            "button"
          )
        ) {
          return;
        }


        openDayEditor(
          date
        );

      }
    );


    cell
      .querySelector(
        ".day-palette-trigger"
      )
      .addEventListener(
        "click",
        e => {

          e.stopPropagation();

          showDayPalette(
            cell,
            date
          );

        }
      );


    const dayPubs =
      publications
        .filter(
          p =>
            p.publication_date ===
            date
        )
        .sort(
          sortPublication
        );


    dayPubs
      .slice(
        0,
        4
      )
      .forEach(
        p => {

          const chip =
            document.createElement(
              "button"
            );


          chip.type =
            "button";


          chip.className =
            `pub-chip ${
              platformClass(
                p.platform
              )
            } ${
              p.status === "done"
                ? "done"
                : ""
            }`;


          chip.innerHTML = `

            <span class="pub-time">
              ${
                p.publication_time
                  ? esc(
                      p.publication_time
                        .slice(0, 5)
                    )
                  : ""
              }
            </span>

            ${esc(p.platform)}
            ·
            ${esc(p.title)}

          `;


          chip.addEventListener(
            "click",
            e => {

              e.stopPropagation();

              openModal(
                p.content_id
              );

            }
          );


          cell.appendChild(
            chip
          );

        }
      );


    if (
      dayPubs.length > 4
    ) {

      const more =
        document.createElement(
          "div"
        );


      more.className =
        "calendar-more";


      more.textContent =
        `+ ещё ${
          dayPubs.length - 4
        }`;


      cell.appendChild(
        more
      );

    }


    grid.appendChild(
      cell
    );

  }

}


function toISO(
  date
) {

  return `${date.getFullYear()}-${pad(
    date.getMonth() + 1
  )}-${pad(
    date.getDate()
  )}`;

}


/* =========================================================
   ASSIGNEES
========================================================= */

function publicationAssignees(
  pubId
) {

  return assigneeRows
    .filter(
      x =>
        x.publication_id ===
        pubId
    )
    .map(
      x =>
        members.find(
          m =>
            m.id ===
            x.user_id
        )
    )
    .filter(Boolean);

}


/* =========================================================
   UPCOMING
========================================================= */

function renderUpcoming() {

  const now =
    new Date();


  const upcoming =
    [...publications]
      .sort(
        sortPublication
      )
      .filter(
        p => {

          const dt =
            p.publication_time

              ? new Date(
                  `${p.publication_date}T${p.publication_time}`
                )

              : new Date(
                  `${p.publication_date}T23:59:00`
                );


          return dt >= now;

        }
      )
      .slice(
        0,
        6
      );


  const box =
    $("upcomingList");


  if (
    !upcoming.length
  ) {

    box.innerHTML = `
      <div class="empty">
        Пока нет запланированных публикаций.
      </div>
    `;

    return;

  }


  box.innerHTML =
    upcoming
      .map(
        p => {

          const names =
            publicationAssignees(
              p.id
            )
              .map(
                m =>
                  m.telegram_first_name ||
                  m.telegram_username
              )
              .slice(
                0,
                3
              )
              .join(
                ", "
              );


          return `

            <button
              class="upcoming-card"
              data-pub="${p.id}"
              type="button"
            >

              <div class="date-box">

                <strong>
                  ${p.publication_date.slice(8)}
                </strong>

                <span>
                  ${
                    shortMonths[
                      Number(
                        p.publication_date.slice(
                          5,
                          7
                        )
                      ) - 1
                    ]
                  }
                </span>

              </div>


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
                          p.publication_time
                            .slice(0, 5)
                        )
                      : ""
                  }

                  ${
                    names
                      ? " · " +
                        esc(names)
                      : ""
                  }

                </div>

              </div>


              <span class="chevron">
                ›
              </span>

            </button>

          `;

        }
      )
      .join("");


  box
    .querySelectorAll(
      "[data-pub]"
    )
    .forEach(
      b => {

        b.onclick =
          () => {

            const p =
              publications.find(
                x =>
                  x.id ===
                  b.dataset.pub
              );


            if (p) {

              openModal(
                p.content_id
              );

            }

          };

      }
    );

}


/* =========================================================
   CONTENT
========================================================= */

function renderContent() {

  const box =
    $("contentList");


  if (!contents.length) {

    box.innerHTML = `

      <div class="empty">

        Контента пока нет.
        Нажми «+ Контент», чтобы добавить.

      </div>

    `;

    return;

  }


  box.innerHTML =
    contents
      .map(
        c => {

          const pubs =
            publications
              .filter(
                p =>
                  p.content_id ===
                  c.id
              )
              .sort(
                sortPublication
              );


          return `

            <button
              class="content-card"
              data-content="${c.id}"
              type="button"
            >

              <div class="content-main">

                <div class="content-title">
                  ${esc(c.title)}
                </div>

                <div class="content-meta">

                  ${pubs.length}

                  ${
                    plural(
                      pubs.length,
                      "публикация",
                      "публикации",
                      "публикаций"
                    )
                  }

                  ${
                    c.description
                      ? " · " +
                        esc(
                          c.description
                        )
                      : ""
                  }

                </div>

              </div>


              <div class="content-right">

                ${
                  pubs
                    .slice(0, 4)
                    .map(
                      p =>
                        `
                          <span class="mini-chip">
                            ${esc(p.platform)}
                            ·
                            ${esc(p.format)}
                          </span>
                        `
                    )
                    .join("")
                }

              </div>

            </button>

          `;

        }
      )
      .join("");


  box
    .querySelectorAll(
      "[data-content]"
    )
    .forEach(
      b => {

        b.onclick =
          () =>
            openModal(
              b.dataset.content
            );

      }
    );

}


/* =========================================================
   TEAM
========================================================= */

function renderTeam() {

  const box =
    $("teamList");


  $("teamCount").textContent =
    `${members.length} ${
      plural(
        members.length,
        "участник",
        "участника",
        "участников"
      )
    }`;


  if (!members.length) {

    box.innerHTML = `

      <div class="empty">

        Участники появятся здесь
        после входа через Telegram.

      </div>

    `;

    return;

  }


  box.innerHTML =
    members
      .map(
        m => `

          <div class="team-card">

            ${avatarHtml(m)}

            <div>

              <div class="team-name">

                ${
                  esc(
                    m.telegram_first_name ||
                    "Без имени"
                  )
                }

              </div>

              <div class="team-handle">

                ${
                  m.telegram_username
                    ? "@" +
                      esc(
                        m.telegram_username
                      )
                    : "Telegram"
                }

              </div>

            </div>

          </div>

        `
      )
      .join("");

}


/* =========================================================
   ANALYTICS
========================================================= */

function renderAnalytics() {

  const list =
    analyticsPeriod();


  $("statTotal").textContent =
    list.length;


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


  $("statWeek").textContent =
    (
      (list.length / days) *
      7
    ).toFixed(1);


  renderBars(
    "platformStats",
    countBy(
      list,
      "platform"
    )
  );


  renderBars(
    "formatStats",
    countBy(
      list,
      "format"
    )
  );


  const weekdays = {};


  list.forEach(
    p => {

      const d =
        new Date(
          `${p.publication_date}T12:00:00`
        );


      const key =
        [
          "Вс",
          "Пн",
          "Вт",
          "Ср",
          "Чт",
          "Пт",
          "Сб"
        ][
          d.getDay()
        ];


      weekdays[key] =
        (
          weekdays[key] ||
          0
        ) + 1;

    }
  );


  renderBars(
    "weekdayStats",
    weekdays
  );


  const workload = {};


  list.forEach(
    p => {

      publicationAssignees(
        p.id
      ).forEach(
        m => {

          const key =
            m.telegram_first_name ||
            m.telegram_username ||
            "Участник";


          workload[key] =
            (
              workload[key] ||
              0
            ) + 1;

        }
      );

    }
  );


  renderBars(
    "assigneeStats",
    workload
  );

}


function analyticsPeriod() {

  const now =
    new Date();


  let from =
    null;


  if (
    activePeriod === "week"
  ) {

    from =
      new Date(
        now.getTime() -
        6 * 86400000
      );

  }


  if (
    activePeriod === "month"
  ) {

    from =
      new Date(
        now.getTime() -
        29 * 86400000
      );

  }


  if (
    activePeriod === "3months"
  ) {

    from =
      new Date(
        now.getTime() -
        89 * 86400000
      );

  }


  const platform =
    $("analyticsPlatform")?.value ||
    "all";


  return publications.filter(
    p => {

      const d =
        new Date(
          `${p.publication_date}T12:00:00`
        );


      const inPeriod =
        !from ||
        d >= from;


      const inPlatform =
        platform === "all" ||
        p.platform === platform;


      return (
        inPeriod &&
        inPlatform
      );

    }
  );

}


function countBy(
  list,
  key
) {

  return list.reduce(
    (a, p) => {

      a[p[key]] =
        (
          a[p[key]] ||
          0
        ) + 1;


      return a;

    },
    {}
  );

}


function renderBars(
  id,
  obj
) {

  const box =
    $(id);


  const entries =
    Object.entries(
      obj
    ).sort(
      (a, b) =>
        b[1] -
        a[1]
    );


  const max =
    entries[0]?.[1] ||
    1;


  box.innerHTML =
    entries.length

      ? `

        <div class="bars">

          ${
            entries
              .map(
                ([name, n]) => `

                  <div class="bar-row">

                    <span>
                      ${esc(name)}
                    </span>

                    <div class="bar-track">

                      <div
                        class="bar-fill"
                        style="width:${Math.max(
                          4,
                          n / max * 100
                        )}%"
                      ></div>

                    </div>

                    <strong>
                      ${n}
                    </strong>

                  </div>

                `
              )
              .join("")
          }

        </div>

      `

      : `

        <div
          class="empty"
          style="padding:18px;margin-top:12px"
        >
          Нет данных
        </div>

      `;

}


/* =========================================================
   HELPERS
========================================================= */

function sortPublication(
  a,
  b
) {

  const aa =
    `${a.publication_date}T${
      a.publication_time ||
      "23:59:59"
    }`;


  const bb =
    `${b.publication_date}T${
      b.publication_time ||
      "23:59:59"
    }`;


  return aa.localeCompare(
    bb
  );

}


function minDate(
  list
) {

  return list.length

    ? list.reduce(
        (a, p) =>
          a < p.publication_date
            ? a
            : p.publication_date,
        list[0].publication_date
      )

    : isoToday();

}


function maxDate(
  list
) {

  return list.length

    ? list.reduce(
        (a, p) =>
          a > p.publication_date
            ? a
            : p.publication_date,
        list[0].publication_date
      )

    : isoToday();

}


function daysBetween(
  a,
  b
) {

  return Math.round(
    (
      new Date(b) -
      new Date(a)
    ) / 86400000
  );

}


function plural(
  n,
  a,
  b,
  c
) {

  const m =
    n % 10;


  const t =
    n % 100;


  return (
    m === 1 &&
    t !== 11
  )

    ? a

    : (
        m >= 2 &&
        m <= 4 &&
        (
          t < 12 ||
          t > 14
        )
      )

      ? b

      : c;

}


/* =========================================================
   MODAL
========================================================= */

function openModal(
  contentId = null,
  presetDate = null
) {

  $("modal")
    .classList
    .remove(
      "hidden"
    );


  $("editingContentId")
    .value =
    contentId ||
    "";


  $("modalTitle")
    .textContent =
    contentId
      ? "Редактировать контент"
      : "Новый контент";


  $("deleteContentBtn")
    .classList
    .toggle(
      "hidden",
      !contentId
    );


  $("contentTitle")
    .value =
    "";


  $("contentDescription")
    .value =
    "";


  $("publicationEditorList")
    .innerHTML =
    "";


  if (contentId) {

    const c =
      contents.find(
        x =>
          x.id ===
          contentId
      );


    if (c) {

      $("contentTitle")
        .value =
        c.title ||
        "";


      $("contentDescription")
        .value =
        c.description ||
        "";

    }


    publications
      .filter(
        p =>
          p.content_id ===
          contentId
      )
      .sort(
        sortPublication
      )
      .forEach(
        addPublicationEditor
      );

  } else {

    addPublicationEditor(
      null,
      presetDate
    );

  }

}


function closeModal() {

  $("modal")
    .classList
    .add(
      "hidden"
    );

}


/* =========================================================
   PUBLICATION EDITOR
========================================================= */

function addPublicationEditor(
  data = null,
  presetDate = null
) {

  const tpl =
    $("publicationTemplate");


  const node =
    tpl.content
      .firstElementChild
      .cloneNode(
        true
      );


  node.dataset.existingId =
    data?.id ||
    "";


  const fields =
    node.querySelectorAll(
      "[data-field]"
    );


  const values = {

    title:
      "",

    platform:
      "Telegram",

    format:
      "Пост",

    date:
      presetDate ||
      isoToday(),

    time:
      "",

    status:
      "planned",

    link:
      "",

    description:
      ""

  };


  fields.forEach(
    el => {

      el.value =
        data?.[
          el.dataset.field
        ] ??
        values[
          el.dataset.field
        ];

    }
  );


  node
    .querySelector(
      '[data-reminder="24h"]'
    )
    .checked =
    data
      ? !!data.reminder_24h
      : true;


  node
    .querySelector(
      '[data-reminder="3h"]'
    )
    .checked =
    data
      ? !!data.reminder_3h
      : false;


  node
    .querySelector(
      '[data-reminder="1h"]'
    )
    .checked =
    data
      ? !!data.reminder_1h
      : false;


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


  const renderPicker =
    () => {

      const search =
        (
          node
            .querySelector(
              "[data-search]"
            )
            .value ||
          ""
        )
          .toLowerCase()
          .trim();


      const opts =
        node.querySelector(
          "[data-options]"
        );


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


      opts.innerHTML = `

        <div class="assignee-options">

          ${
            filtered
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

                      ${
                        esc(
                          m.telegram_first_name ||
                          "Без имени"
                        )
                      }

                      ${
                        m.telegram_username
                          ? " · @" +
                            esc(
                              m.telegram_username
                            )
                          : ""
                      }

                    </span>

                  </label>

                `
              )
              .join("")
          }

        </div>

      `;


      opts
        .querySelectorAll(
          "[data-user]"
        )
        .forEach(
          cb => {

            cb.addEventListener(
              "change",
              () => {

                if (
                  cb.checked
                ) {

                  selected.add(
                    cb.dataset.user
                  );

                } else {

                  selected.delete(
                    cb.dataset.user
                  );

                }


                renderPicker();

              }
            );

          }
        );


      const sel =
        node.querySelector(
          "[data-selected]"
        );


      sel.innerHTML =
        [...selected]
          .map(
            id =>
              members.find(
                m =>
                  m.id === id
              )
          )
          .filter(Boolean)
          .map(
            m => `

              <span class="assignee-tag">

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
          .join("");


      sel
        .querySelectorAll(
          "[data-remove]"
        )
        .forEach(
          b => {

            b.onclick =
              () => {

                selected.delete(
                  b.dataset.remove
                );

                renderPicker();

              };

          }
        );

    };


  node
    .querySelector(
      "[data-search]"
    )
    .addEventListener(
      "input",
      renderPicker
    );


  renderPicker();


  node
    .querySelector(
      ".remove-publication"
    )
    .onclick =
    () => {

      if (
        document.querySelectorAll(
          "[data-publication]"
        ).length <= 1
      ) {

        toast(
          "Должна остаться хотя бы одна публикация"
        );

        return;

      }


      node.remove();

      renumberEditors();

    };


  $("publicationEditorList")
    .appendChild(
      node
    );


  renumberEditors();

}


function renumberEditors() {

  document
    .querySelectorAll(
      "[data-publication] .pub-number"
    )
    .forEach(
      (
        el,
        i
      ) => {

        el.textContent =
          `Публикация ${
            i + 1
          }`;

      }
    );

}


/* =========================================================
   SAVE
========================================================= */

async function saveContent(
  e
) {

  e.preventDefault();


  if (!currentProject) {
    return;
  }


  const contentId =
    $("editingContentId")
      .value ||
    null;


  const title =
    $("contentTitle")
      .value
      .trim();


  if (!title) {
    return;
  }


  let savedContent;


  if (contentId) {

    const {
      data,
      error
    } =
      await db
        .from("content")
        .update(
          {
            title,

            description:
              $("contentDescription")
                .value
                .trim()
          }
        )
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

  } else {

    const {
      data,
      error
    } =
      await db
        .from("content")
        .insert(
          {
            project_id:
              currentProject.id,

            title,

            description:
              $("contentDescription")
                .value
                .trim(),

            created_by:
              currentUser.id
          }
        )
        .select()
        .single();


    if (error) {
      throw error;
    }


    savedContent =
      data;

  }


  const editorNodes =
    [
      ...document.querySelectorAll(
        "[data-publication]"
      )
    ];


  const keptIds =
    [];


  for (
    const node of editorNodes
  ) {

    const get =
      f =>
        node
          .querySelector(
            `[data-field="${f}"]`
          )
          .value;


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
        get("status"),

      link:
        get("link").trim() ||
        null,

      description:
        get("description").trim() ||
        null,

      reminder_24h:
        node.querySelector(
          '[data-reminder="24h"]'
        ).checked,

      reminder_3h:
        node.querySelector(
          '[data-reminder="3h"]'
        ).checked,

      reminder_1h:
        node.querySelector(
          '[data-reminder="1h"]'
        ).checked

    };


    if (!payload.title) {

      toast(
        "У каждой публикации должно быть название"
      );

      throw new Error(
        "Пустое название публикации"
      );

    }


    const existingId =
      node.dataset.existingId;


    let pub;

    let error;


    if (existingId) {

      ({
        data: pub,
        error
      } =
        await db
          .from(
            "publications"
          )
          .update(
            payload
          )
          .eq(
            "id",
            existingId
          )
          .select()
          .single());

    } else {

      ({
        data: pub,
        error
      } =
        await db
          .from(
            "publications"
          )
          .insert(
            payload
          )
          .select()
          .single());

    }


    if (error) {
      throw error;
    }


    keptIds.push(
      pub.id
    );


    const selected =
      [
        ...node._selected
      ];


    const {
      error: deleteAssigneesError
    } =
      await db
        .from(
          "publication_assignees"
        )
        .delete()
        .eq(
          "publication_id",
          pub.id
        );


    if (deleteAssigneesError) {
      throw deleteAssigneesError;
    }


    if (selected.length) {

      const rows =
        selected.map(
          user_id => ({
            publication_id:
              pub.id,

            user_id
          })
        );


      const {
        error: ae
      } =
        await db
          .from(
            "publication_assignees"
          )
          .insert(
            rows
          );


      if (ae) {
        throw ae;
      }

    }

  }


  if (contentId) {

    const removed =
      publications
        .filter(
          p =>
            p.content_id ===
              contentId &&

            !keptIds.includes(
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

      const {
        error
      } =
        await db
          .from(
            "publications"
          )
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


  closeModal();

  await loadContent();

  renderEverything();

  toast(
    "Сохранено"
  );

}


/* =========================================================
   DELETE CONTENT
========================================================= */

async function deleteContent() {

  const id =
    $("editingContentId")
      .value;


  if (!id) {
    return;
  }


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
    await db
      .from("content")
      .delete()
      .eq(
        "id",
        id
      );


  if (error) {

    toast(
      "Не удалось удалить"
    );

    console.error(
      error
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


/* =========================================================
   BUTTONS
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


/* НОВАЯ КНОПКА + НА КАЛЕНДАРЕ */

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


/* + КОНТЕНТ */

$("addContentInline")
  ?.addEventListener(
    "click",
    () => {

      openModal();

    }
  );


/* + ПУБЛИКАЦИЯ ВНУТРИ КОНТЕНТА */

$("addPublication")
  ?.addEventListener(
    "click",
    () => {

      addPublicationEditor();

    }
  );


$("contentForm")
  ?.addEventListener(
    "submit",
    e =>
      saveContent(
        e
      ).catch(
        err => {

          console.error(
            err
          );

          toast(
            err.message ||
            "Ошибка сохранения"
          );

        }
      )
  );


$("deleteContentBtn")
  ?.addEventListener(
    "click",
    () =>
      deleteContent()
  );


document
  .querySelectorAll(
    "[data-close-modal]"
  )
  .forEach(
    el =>
      el.addEventListener(
        "click",
        closeModal
      )
  );


document
  .querySelectorAll(
    ".nav-item"
  )
  .forEach(
    b =>
      b.addEventListener(
        "click",
        () =>
          switchView(
            b.dataset.view
          )
      )
  );


$("showAllContent")
  ?.addEventListener(
    "click",
    () =>
      switchView(
        "contentView"
      )
  );


document
  .querySelectorAll(
    ".filter-btn"
  )
  .forEach(
    b =>
      b.addEventListener(
        "click",
        () => {

          activePeriod =
            b.dataset.period;


          document
            .querySelectorAll(
              ".filter-btn"
            )
            .forEach(
              x =>
                x.classList.toggle(
                  "active",
                  x === b
                )
            );


          renderAnalytics();

        }
      )
  );


$("analyticsPlatform")
  ?.addEventListener(
    "change",
    renderAnalytics
  );


/* =========================================================
   RUN
========================================================= */

boot();
