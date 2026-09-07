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

let currentMonth = new Date();

let activePeriod = "week";

let saving = false;

let memberPoll = null;
let plannerPoll = null;

let realtimeChannels = [];

let selectedDayForNewPublication = null;


/* =========================================================
   HELPERS
   ========================================================= */

const $ = id => document.getElementById(id);

const esc = value =>
  String(value ?? "").replace(
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

function toISO(date) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-");
}

function isoToday() {
  return toISO(new Date());
}

function formatDate(date) {
  if (!date) return "";

  const parts = date.split("-").map(Number);

  const day = parts[2];
  const month = parts[1];

  return `${day} ${shortMonths[month - 1]}`;
}

function formatLongDate(date) {
  if (!date) return "";

  const parts = date.split("-").map(Number);

  const year = parts[0];
  const month = parts[1];
  const day = parts[2];

  return `${day} ${shortMonths[month - 1]} ${year}`;
}

function sortPublication(a, b) {
  const first =
    `${a.publication_date}T${a.publication_time || "23:59:59"}`;

  const second =
    `${b.publication_date}T${b.publication_time || "23:59:59"}`;

  return first.localeCompare(second);
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
  }, 2400);
}


/* =========================================================
   TELEGRAM
   ========================================================= */

function telegramInitData() {
  return tg?.initData || "";
}


/* =========================================================
   START
   ========================================================= */

async function boot() {
  try {
    /*
      Telegram
    */

    tg?.ready();
    tg?.expand();

    tg?.setHeaderColor?.("#f7f7f5");
    tg?.setBackgroundColor?.("#f7f7f5");


    /*
      Получаем Supabase-сессию.

      Если пользователь открывает приложение
      напрямую с компьютера — создаём техническую
      anonymous-сессию.

      Если приложение открыто из Telegram —
      потом дополнительно проходит Telegram-auth.
    */

    let session =
      (await db.auth.getSession()).data.session;

    if (!session) {
      const result =
        await db.auth.signInAnonymously();

      if (result.error) {
        throw result.error;
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


    /*
      Telegram authentication

      На компьютере initData может отсутствовать,
      поэтому Telegram-auth там не вызывается.
    */

    const initData = telegramInitData();

    if (initData) {
      const result =
        await db.functions.invoke(
          "telegram-auth",
          {
            body: {
              initData
            }
          }
        );

      if (result.error) {
        throw result.error;
      }
    }


    /*
      Загружаем профиль,
      проект и данные планера.
    */

    await loadProfile();

    await ensureProject();

    await loadAll();

    setupRealtime();

    startPolling();

    bindEvents();

    showApp();

  } catch (error) {

    console.error(
      "BOOT ERROR:",
      error
    );

    showAuthError(
      error?.message ||
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
      .eq("id", currentUser.id)
      .maybeSingle();

  if (error) {
    throw error;
  }

  currentProfile =
    data ||
    {
      id: currentUser.id,
      telegram_first_name: "Участник"
    };
}


/* =========================================================
   PROJECT
   ========================================================= */

async function ensureProject() {

  const {
    data,
    error
  } =
    await db.rpc(
      "get_default_project_for_user"
    );

  if (error) {
    throw error;
  }

  if (Array.isArray(data)) {
    currentProject = data[0];
  } else {
    currentProject = data;
  }

  if (!currentProject) {
    throw new Error(
      "Не найден проект команды."
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
   MEMBERS
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

    members =
      currentProfile?.telegram_id
        ? [currentProfile]
        : [];

    return;
  }

  members = data || [];

  /*
    Если текущий Telegram-пользователь
    почему-то отсутствует в выдаче —
    добавляем его отдельно.
  */

  if (
    currentProfile?.telegram_id &&
    !members.some(
      member =>
        member.id === currentProfile.id
    )
  ) {
    members.unshift(
      currentProfile
    );
  }
}


/* =========================================================
   CONTENT + PUBLICATIONS
   ========================================================= */

async function loadContent() {

  if (!currentProject) {
    return;
  }


  /*
    Контент
  */

  const {
    data: contentData,
    error: contentError
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

  if (contentError) {
    throw contentError;
  }


  /*
    Публикации
  */

  const {
    data: publicationData,
    error: publicationError
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

  if (publicationError) {
    throw publicationError;
  }


  /*
    Ответственные
  */

  const publicationIds =
    (publicationData || [])
      .map(item => item.id);

  let assignees = [];

  if (publicationIds.length) {

    const {
      data,
      error
    } =
      await db
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
                "Realtime error:",
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
    Обновление команды
  */

  memberPoll =
    setInterval(
      async () => {

        try {

          await loadMembers();

          renderTeam();

          renderAnalytics();

        } catch (error) {

          console.warn(
            "Member polling error:",
            error
          );
        }

      },
      15000
    );


  /*
    Обновление контента
  */

  plannerPoll =
    setInterval(
      async () => {

        try {

          await loadContent();

          renderEverything();

        } catch (error) {

          console.warn(
            "Planner polling error:",
            error
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
    <div class="logo-mark">!</div>

    <h1>
      Не удалось открыть
    </h1>

    <p>
      ${esc(message)}
    </p>
  `;
}


/* =========================================================
   NAVIGATION
   ========================================================= */

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
   CALENDAR
   ========================================================= */

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
    Понедельник = первый день недели.
  */

  const leading =
    (
      firstDay.getDay() + 6
    ) % 7;


  const total =
    Math.ceil(
      (
        leading +
        daysInMonth
      ) / 7
    ) * 7;


  grid.innerHTML = "";


  for (
    let index = 0;
    index < total;
    index++
  ) {

    const day =
      index -
      leading +
      1;


    const dateObject =
      new Date(
        year,
        month,
        day
      );


    const date =
      toISO(
        dateObject
      );


    const cell =
      document.createElement(
        "div"
      );


    cell.className =
      "calendar-cell";


    if (
      dateObject.getMonth() !==
      month
    ) {

      cell.classList.add(
        "other-month"
      );
    }


    const isToday =
      date === isoToday();


    cell.innerHTML = `
      <div class="calendar-date">

        <span class="calendar-date-number">
          ${dateObject.getDate()}
        </span>

      </div>

      <div class="calendar-publications"></div>
    `;


    if (isToday) {

      cell.classList.add(
        "today"
      );
    }


    cell.addEventListener(
      "click",
      () =>
        openDayDetails(date)
    );


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


    const publicationBox =
      cell.querySelector(
        ".calendar-publications"
      );


    dayPublications
      .slice(0, 3)
      .forEach(
        publication => {

          const chip =
            document.createElement(
              "button"
            );

          chip.type =
            "button";

          chip.className =
            `publication-chip ${platformClass(publication.platform)}${publication.status === "done" ? " done" : ""}`;


          chip.innerHTML = `
            <div class="publication-chip-title">
              ${esc(publication.title)}
            </div>

            <div class="publication-chip-platform">
              ${esc(publication.platform)}
            </div>
          `;


          chip.addEventListener(
            "click",
            event => {

              event.stopPropagation();

              openModal(
                publication.content_id
              );
            }
          );


          publicationBox.appendChild(
            chip
          );
        }
      );


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
        `+ ещё ${dayPublications.length - 3}`;


      more.addEventListener(
        "click",
        event => {

          event.stopPropagation();

          openDayDetails(
            date
          );
        }
      );


      publicationBox.appendChild(
        more
      );
    }


    grid.appendChild(
      cell
    );
  }
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


  const list =
    publications
      .filter(
        publication => {

          const date =
            `${publication.publication_date}T${publication.publication_time || "23:59:59"}`;

          return (
            new Date(date) >= now
          );
        }
      )
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
        publication => {

          const day =
            Number(
              publication.publication_date
                .slice(8, 10)
            );

          const month =
            Number(
              publication.publication_date
                .slice(5, 7)
            );


          return `
            <button
              type="button"
              class="upcoming-card"
              data-upcoming="${publication.id}"
            >

              <div class="date-box">

                <strong>
                  ${String(day).padStart(2, "0")}
                </strong>

                <span>
                  ${shortMonths[month - 1].toUpperCase()}
                </span>

              </div>


              <span
                class="platform-dot ${platformClass(publication.platform)}"
              ></span>


              <div class="upcoming-main">

                <div class="upcoming-title">
                  ${esc(publication.title)}
                </div>

                <div class="upcoming-meta">
                  ${esc(publication.platform)}
                  ·
                  ${esc(publication.format)}
                  ${
                    publication.publication_time
                      ? " · " +
                        esc(
                          publication.publication_time.slice(0, 5)
                        )
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
      "[data-upcoming]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const publication =
            publications.find(
              item =>
                item.id ===
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
        ?.value ||
      ""
    )
      .trim()
      .toLowerCase();


  const platform =
    $("platformFilter")
      ?.value ||
    "";


  const filtered =
    contents.filter(
      content => {

        const contentPublications =
          publications.filter(
            publication =>
              publication.content_id ===
              content.id
          );


        const text = [
          content.title,
          content.description,
          ...contentPublications.flatMap(
            publication => [
              publication.title,
              publication.platform,
              publication.format,
              publication.description
            ]
          )
        ]
          .join(" ")
          .toLowerCase();


        const matchesSearch =
          !search ||
          text.includes(search);


        const matchesPlatform =
          !platform ||
          contentPublications.some(
            publication =>
              publication.platform ===
              platform
          );


        return (
          matchesSearch &&
          matchesPlatform
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
      .map(
        content => {

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


          const publicationCount =
            contentPublications.length;


          let countLabel =
            "публикаций";

          if (
            publicationCount === 1
          ) {
            countLabel =
              "публикация";
          } else if (
            publicationCount >= 2 &&
            publicationCount <= 4
          ) {
            countLabel =
              "публикации";
          }


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
                          ${esc(content.description)}
                        </div>
                      `
                      : ""
                  }


                  <div class="content-meta">
                    ${publicationCount} ${countLabel}
                  </div>

                </div>


                <span class="chevron">
                  ›
                </span>

              </div>


              <div class="content-publications">

                ${
                  contentPublications
                    .map(
                      publication => `
                        <button
                          type="button"
                          class="content-publication"
                          data-publication-id="${publication.id}"
                        >

                          <span
                            class="platform-dot ${platformClass(publication.platform)}"
                          ></span>


                          <div class="content-pub-main">

                            <div class="content-pub-title">
                              ${esc(publication.title)}
                            </div>


                            <div class="content-pub-meta">
                              ${formatDate(publication.publication_date)}
                              ${
                                publication.publication_time
                                  ? " · " +
                                    esc(
                                      publication.publication_time.slice(0, 5)
                                    )
                                  : ""
                              }
                              ·
                              ${esc(publication.platform)}
                              ·
                              ${esc(publication.format)}
                            </div>

                          </div>


                          <span
                            class="status-pill ${publication.status || ""}"
                          >
                            ${statusLabel(publication.status)}
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
        }
      )
      .join("");


  /*
    Открытие редактора контента
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
    Открытие конкретной публикации
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

  if (!box) {
    return;
  }


  const count =
    members.length;


  let label =
    "участников";

  if (count === 1) {
    label =
      "участник";
  } else if (
    count >= 2 &&
    count <= 4
  ) {
    label =
      "участника";
  }


  const countElement =
    $("teamCount");

  if (countElement) {

    countElement.textContent =
      `${count} ${label}`;
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
      .map(
        member => {

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
                    src="${esc(member.telegram_photo_url)}"
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
                        esc(member.telegram_username)
                      : "Telegram"
                  }
                </div>

              </div>

            </div>
          `;
        }
      )
      .join("");
}


/* =========================================================
   ANALYTICS
   ========================================================= */

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
    "";


  return publications.filter(
    publication => {

      const date =
        new Date(
          `${publication.publication_date}T12:00:00`
        );


      const matchesDate =
        !from ||
        date >= from;


      const matchesPlatform =
        !platform ||
        publication.platform ===
        platform;


      return (
        matchesDate &&
        matchesPlatform
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
        "Не указано";


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
  box,
  values
) {

  if (!box) {
    return;
  }


  const entries =
    Object.entries(values)
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
    entries
      .map(
        ([name, count]) => {

          const width =
            Math.max(
              5,
              (count / max) * 100
            );


          return `
            <div class="bar-row">

              <span>
                ${esc(name)}
              </span>


              <div class="bar-track">

                <div
                  class="bar-fill"
                  style="width:${width}%"
                ></div>

              </div>


              <strong>
                ${count}
              </strong>

            </div>
          `;
        }
      )
      .join("");
}


/* =========================================================
   RENDER ANALYTICS
   ========================================================= */

function renderAnalytics() {

  const list =
    analyticsPeriodList();


  const total =
    $("analyticsTotal");

  if (total) {

    total.textContent =
      list.length;
  }


  let days =
    7;


  if (
    activePeriod ===
    "month"
  ) {

    days =
      30;
  }


  if (
    activePeriod ===
    "3months"
  ) {

    days =
      90;
  }


  if (
    activePeriod ===
    "all"
  ) {

    if (list.length) {

      const dates =
        list
          .map(
            publication =>
              new Date(
                `${publication.publication_date}T12:00:00`
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
  }


  const average =
    list.length /
    days *
    7;


  const averageElement =
    $("analyticsAverage");

  if (averageElement) {

    averageElement.textContent =
      average.toFixed(1);
  }


  renderBars(
    $("analyticsPlatforms"),
    countBy(
      list,
      "platform"
    )
  );


  renderBars(
    $("analyticsFormats"),
    countBy(
      list,
      "format"
    )
  );


  const weekdays =
    {};


  list.forEach(
    publication => {

      const date =
        new Date(
          `${publication.publication_date}T12:00:00`
        );


      const weekday =
        weekdayNames[
          date.getDay()
        ];


      weekdays[weekday] =
        (
          weekdays[weekday] ||
          0
        ) + 1;
    }
  );


  renderBars(
    $("analyticsWeekdays"),
    weekdays
  );


  const assignees =
    {};


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
            (
              assignees[name] ||
              0
            ) + 1;
        }
      );
    }
  );


  renderBars(
    $("analyticsAssignees"),
    assignees
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
   DAY MODAL
   ========================================================= */

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
        publication =>
          publication.publication_date ===
          date
      )
      .sort(
        sortPublication
      );


  const eyebrow =
    $("dayModalEyebrow");

  if (eyebrow) {

    eyebrow.textContent =
      formatLongDate(date);
  }


  const title =
    $("dayModalTitle");

  if (title) {

    let label =
      "публикаций";

    if (list.length === 1) {
      label =
        "публикация";
    } else if (
      list.length >= 2 &&
      list.length <= 4
    ) {
      label =
        "публикации";
    }


    title.textContent =
      `${list.length} ${label}`;
  }


  const dateElement =
    $("dayModalDate");

  if (dateElement) {

    dateElement.textContent =
      "Расписание на выбранную дату";
  }


  const listElement =
    $("dayPublicationList");


  if (!listElement) {
    return;
  }


  if (!list.length) {

    listElement.innerHTML = `
      <div class="empty">
        На этот день публикаций нет.
      </div>
    `;

  } else {

    listElement.innerHTML =
      list
        .map(
          publication => `
            <button
              type="button"
              class="day-publication"
              data-day-pub="${publication.id}"
            >

              <div class="day-pub-time">
                ${
                  publication.publication_time
                    ? esc(
                        publication.publication_time.slice(0, 5)
                      )
                    : "—"
                }
              </div>


              <div class="day-pub-main">

                <div class="day-pub-title">
                  ${esc(publication.title)}
                </div>


                <div class="day-pub-meta">
                  ${esc(publication.platform)}
                  ·
                  ${esc(publication.format)}
                  ·
                  ${statusLabel(publication.status)}
                </div>

              </div>


              <span class="chevron">
                ›
              </span>

            </button>
          `
        )
        .join("");


    listElement
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


  modal.classList.remove(
    "hidden"
  );


  requestAnimationFrame(
    () => {

      modal
        .querySelector(
          ".modal-sheet"
        )
        ?.scrollTo({
          top: 0,
          behavior: "instant"
        });
    }
  );
}


function closeDayDetails() {

  $("dayModal")
    ?.classList
    .add("hidden");
}


/* =========================================================
   CONTENT MODAL
   ========================================================= */

function openModal(
  contentId = null,
  presetDate = null
) {

  const modal =
    $("contentModal");

  if (!modal) {
    return;
  }


  modal.classList.remove(
    "hidden"
  );


  const idField =
    $("contentId");

  if (idField) {

    idField.value =
      contentId || "";
  }


  const title =
    $("contentModalTitle");

  if (title) {

    title.textContent =
      contentId
        ? "Редактировать контент"
        : "Новый контент";
  }


  const deleteButton =
    $("deleteContentButton");

  if (deleteButton) {

    deleteButton.classList.toggle(
      "hidden",
      !contentId
    );
  }


  const contentTitle =
    $("contentTitle");

  const contentDescription =
    $("contentDescription");

  const publicationsEditor =
    $("publicationsEditor");


  if (contentTitle) {
    contentTitle.value = "";
  }

  if (contentDescription) {
    contentDescription.value = "";
  }

  if (publicationsEditor) {
    publicationsEditor.innerHTML = "";
  }


  if (contentId) {

    const content =
      contents.find(
        item =>
          item.id ===
          contentId
      );


    if (content) {

      if (contentTitle) {

        contentTitle.value =
          content.title ||
          "";
      }


      if (contentDescription) {

        contentDescription.value =
          content.description ||
          "";
      }
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

  } else {

    addPublicationEditor(
      null,
      presetDate ||
      isoToday()
    );
  }


  requestAnimationFrame(
    () => {

      modal
        .querySelector(
          ".modal-sheet"
        )
        ?.scrollTo({
          top: 0,
          behavior: "instant"
        });
    }
  );
}


function closeModal() {

  $("contentModal")
    ?.classList
    .add("hidden");
}


/* =========================================================
   ADD PUBLICATION EDITOR
   ========================================================= */

function addPublicationEditor(
  data = null,
  presetDate = null
) {

  const wrapper =
    $("publicationsEditor");

  if (!wrapper) {
    return;
  }


  const node =
    document.createElement(
      "article"
    );


  node.className =
    "publication-editor";


  node.dataset.publication =
    "1";


  node.dataset.existingId =
    data?.id ||
    "";


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
          value="${esc(data?.title || "")}"
        >

      </label>


      <label class="field">

        <span>
          Соцсеть
        </span>

        <select
          data-field="platform"
        >

          <option value="Telegram">
            Telegram
          </option>

          <option value="Instagram">
            Instagram
          </option>

          <option value="VK">
            VK
          </option>

          <option value="TikTok">
            TikTok
          </option>

          <option value="YouTube">
            YouTube
          </option>

          <option value="Другое">
            Другое
          </option>

        </select>

      </label>


      <label class="field">

        <span>
          Формат
        </span>

        <input
          data-field="format"
          value="${esc(data?.format || "Пост")}"
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

        <select
          data-field="status"
        >

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
            data?.link ||
            ""
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
          data?.description ||
          ""
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


  /*
    Значения select
  */

  const platformSelect =
    node.querySelector(
      '[data-field="platform"]'
    );

  if (platformSelect) {

    platformSelect.value =
      data?.platform ||
      "Telegram";
  }


  const statusSelect =
    node.querySelector(
      '[data-field="status"]'
    );

  if (statusSelect) {

    statusSelect.value =
      data?.status ||
      "planned";
  }


  /*
    Ответственные
  */

  const renderPicker =
    () => {

      const search =
        (
          node
            .querySelector(
              "[data-search]"
            )
            ?.value ||
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


      if (!selectedBox ||
          !optionsBox) {
        return;
      }


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


      selectedBox.innerHTML =
        chosen.length
          ? chosen
              .map(
                member => `
                  <span class="assignee-tag">

                    ${esc(
                      member.telegram_first_name ||
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


      const filtered =
        members.filter(
          member => {

            const name =
              (
                member.telegram_first_name ||
                ""
              )
                .toLowerCase();


            const username =
              (
                member.telegram_username ||
                ""
              )
                .toLowerCase();


            return (
              name.includes(search) ||
              username.includes(search)
            );
          }
        );


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


      optionsBox
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


  renderPicker();


  /*
    Удаление публикации
  */

  const removeButton =
    node.querySelector(
      ".remove-publication"
    );


  if (removeButton) {

    removeButton.addEventListener(
      "click",
      () => {

        const editors =
          document.querySelectorAll(
            "#publicationsEditor [data-publication]"
          );


        if (
          editors.length <= 1
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
  }


  wrapper.appendChild(
    node
  );


  renumberEditors();
}


/* =========================================================
   RENUMBER PUBLICATIONS
   ========================================================= */

function renumberEditors() {

  document
    .querySelectorAll(
      "#publicationsEditor [data-publication] .pub-number"
    )
    .forEach(
      (element, index) => {

        element.textContent =
          `Публикация ${index + 1}`;
      }
    );
}


/* =========================================================
   SAVE CONTENT
   ========================================================= */

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
    (
      $("contentTitle")
        ?.value ||
      ""
    ).trim();


  if (!title) {

    toast(
      "Введите название контента"
    );

    return;
  }


  const nodes =
    [
      ...document.querySelectorAll(
        "#publicationsEditor [data-publication]"
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
      )?.value.trim();


    const publicationDate =
      node.querySelector(
        '[data-field="date"]'
      )?.value;


    if (
      !publicationTitle ||
      !publicationDate
    ) {

      toast(
        "Заполните название и дату публикации"
      );

      return;
    }
  }


  saving = true;


  const button =
    $("saveContentButton");


  if (button) {

    button.disabled =
      true;

    button.textContent =
      "Сохраняем…";
  }


  try {

    const contentId =
      (
        $("contentId")
          ?.value ||
        ""
      ) || null;


    const payload = {
      title,
      description:
        (
          $("contentDescription")
            ?.value ||
          ""
        ).trim() ||
        null
    };


    let savedContent;


    /*
      Обновляем существующий контент
    */

    if (contentId) {

      const {
        data,
        error
      } =
        await db
          .from("content")
          .update(payload)
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

      /*
        Создаём новый контент
      */

      const {
        data,
        error
      } =
        await db
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


      savedContent =
        data;
    }


    const keptPublicationIds =
      [];


    /*
      Сохраняем публикации
    */

    for (
      const node of nodes
    ) {

      const get =
        field =>
          node.querySelector(
            `[data-field="${field}"]`
          )?.value ||
          "";


      const publicationPayload = {

        content_id:
          savedContent.id,

        project_id:
          currentProject.id,

        title:
          get("title").trim(),

        platform:
          get("platform"),

        format:
          get("format").trim() ||
          "Пост",

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


      let savedPublication;


      /*
        Существующая публикация
      */

      if (existingId) {

        const {
          data,
          error
        } =
          await db
            .from("publications")
            .update(
              publicationPayload
            )
            .eq(
              "id",
              existingId
            )
            .select()
            .single();


        if (error) {
          throw error;
        }


        savedPublication =
          data;


      } else {

        /*
          Новая публикация
        */

        const {
          data,
          error
        } =
          await db
            .from("publications")
            .insert(
              publicationPayload
            )
            .select()
            .single();


        if (error) {
          throw error;
        }


        savedPublication =
          data;
      }


      keptPublicationIds.push(
        savedPublication.id
      );


      /*
        Пересохраняем ответственных
      */

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
            savedPublication.id
          );


      if (
        deleteAssigneesError
      ) {

        throw deleteAssigneesError;
      }


      const selected =
        [
          ...(node._selected ||
            new Set())
        ];


      if (selected.length) {

        const {
          error:
            insertAssigneesError
        } =
          await db
            .from(
              "publication_assignees"
            )
            .insert(
              selected.map(
                userId => ({
                  publication_id:
                    savedPublication.id,

                  user_id:
                    userId
                })
              )
            );


        if (
          insertAssigneesError
        ) {

          throw insertAssigneesError;
        }
      }
    }


    /*
      Удаляем публикации,
      которые были удалены из редактора
    */

    if (contentId) {

      const removed =
        publications
          .filter(
            publication =>
              publication.content_id ===
              contentId &&
              !keptPublicationIds.includes(
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
        } =
          await db
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


/* =========================================================
   DELETE CONTENT
   ========================================================= */

async function deleteContent() {

  const id =
    $("contentId")
      ?.value;


  if (!id) {
    return;
  }


  const confirmed =
    window.confirm(
      "Удалить этот контент и все его публикации?"
    );


  if (!confirmed) {
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


/* =========================================================
   BIND EVENTS
   ========================================================= */

function bindEvents() {

  /*
    Месяцы
  */

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


  $("todayButton")
    ?.addEventListener(
      "click",
      () => {

        currentMonth =
          new Date();

        renderCalendar();
      }
    );


  /*
    Верхняя кнопка +
  */

  $("topAddButton")
    ?.addEventListener(
      "click",
      () =>
        openModal(
          null,
          isoToday()
        )
    );


  /*
    + Контент
  */

  $("addContentButton")
    ?.addEventListener(
      "click",
      () =>
        openModal()
    );


  /*
    + Публикация
  */

  $("addPublicationButton")
    ?.addEventListener(
      "click",
      () =>
        addPublicationEditor()
    );


  /*
    Добавить публикацию
    для выбранного дня
  */

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


  /*
    Сохранение
  */

  $("contentForm")
    ?.addEventListener(
      "submit",
      saveContent
    );


  /*
    Удаление
  */

  $("deleteContentButton")
    ?.addEventListener(
      "click",
      deleteContent
    );


  /*
    Все публикации
  */

  $("allContentButton")
    ?.addEventListener(
      "click",
      () =>
        switchView(
          "contentView"
        )
    );


  /*
    Поиск контента
  */

  $("contentSearch")
    ?.addEventListener(
      "input",
      renderContent
    );


  /*
    Фильтр соцсети
  */

  $("platformFilter")
    ?.addEventListener(
      "change",
      renderContent
    );


  /*
    Аналитика — соцсеть
  */

  $("analyticsPlatform")
    ?.addEventListener(
      "change",
      renderAnalytics
    );


  /*
    Аналитика — период
  */

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
                    item === button
                  )
              );


            renderAnalytics();
          }
        );
      }
    );


  /*
    Нижняя навигация
  */

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


  /*
    Закрытие контента
  */

  document
    .querySelectorAll(
      "[data-close-content]"
    )
    .forEach(
      element => {

        element.addEventListener(
          "click",
          closeModal
        );
      }
    );


  /*
    Закрытие дня
  */

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


  /*
    Кнопка закрытия редактора
  */

  $("closeContentModal")
    ?.addEventListener(
      "click",
      closeModal
    );


  /*
    Кнопка отмены
  */

  $("cancelContentButton")
    ?.addEventListener(
      "click",
      closeModal
    );


  /*
    Кнопка закрытия дня
  */

  $("closeDayModal")
    ?.addEventListener(
      "click",
      closeDayDetails
    );


  /*
    Escape
  */

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


/* =========================================================
   START APP
   ========================================================= */

boot();
