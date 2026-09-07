const SUPABASE_URL = "https://vkvrwayzqrlsfsgjjwpy.supabase.co";
const SUPABASE_KEY = "sb_publishable_-kj7hiC7uou3db2wpwFM_w_jgXQNpnb";

const { createClient } = supabase;

const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
});

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

let realtimeChannels = [];
let refreshTimer = null;
let refreshing = false;

const $ = id => document.getElementById(id);

const esc = (value = "") =>
  String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));

const pad = n => String(n).padStart(2, "0");

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

function telegramInitData() {
  return tg?.initData || "";
}

function toast(text) {
  document.querySelectorAll(".toast").forEach(el => el.remove());

  const el = document.createElement("div");

  el.className = "toast";

  el.textContent = text;

  el.style.cssText = `
    position:fixed;
    left:50%;
    bottom:95px;
    transform:translateX(-50%);
    z-index:9999;
    padding:11px 15px;
    border-radius:13px;
    background:#111;
    color:#fff;
    font-size:12px;
    font-weight:600;
    box-shadow:0 8px 25px rgba(0,0,0,.18);
  `;

  document.body.appendChild(el);

  setTimeout(() => el.remove(), 2200);
}

function avatarHtml(profile, cls = "") {
  const name =
    profile?.telegram_first_name ||
    profile?.telegram_username ||
    "?";

  const initials = name.slice(0, 2).toUpperCase();

  if (profile?.telegram_photo_url) {
    return `
      <div class="avatar ${cls}">
        <img src="${esc(profile.telegram_photo_url)}" alt="">
      </div>
    `;
  }

  return `
    <div class="avatar ${cls}">
      ${esc(initials)}
    </div>
  `;
}

function platformClass(platform) {
  const value = String(platform || "").toLowerCase();

  if (value.includes("telegram")) return "telegram";
  if (value.includes("instagram")) return "instagram";
  if (value === "vk" || value.includes("вк")) return "vk";
  if (value.includes("tiktok") || value.includes("тикток")) return "tiktok";
  if (value.includes("youtube") || value.includes("ютуб")) return "youtube";

  return "other";
}

function platformShort(platform) {
  const cls = platformClass(platform);

  return {
    telegram: "TG",
    instagram: "IG",
    vk: "VK",
    tiktok: "TT",
    youtube: "YT",
    other: "•"
  }[cls];
}

function formatDate(date) {
  if (!date) return "";

  const [year, month, day] = date.split("-").map(Number);

  return `${day} ${shortMonths[month - 1]}`;
}

function publicationDateTime(publication) {
  return new Date(
    `${publication.publication_date}T${publication.publication_time || "23:59:59"}`
  );
}

function sortPublication(a, b) {
  return publicationDateTime(a) - publicationDateTime(b);
}


/* =========================================================
   ЗАПУСК
   ========================================================= */

async function boot() {
  try {
    tg?.ready();
    tg?.expand();

    tg?.setHeaderColor?.("#f5f5f3");
    tg?.setBackgroundColor?.("#f5f5f3");

    const {
      data: sessionData,
      error: sessionError
    } = await db.auth.getSession();

    if (sessionError) throw sessionError;

    if (!sessionData.session) {
      const { error } = await db.auth.signInAnonymously();

      if (error) throw error;
    }

    const {
      data: sessionNow,
      error: sessionNowError
    } = await db.auth.getSession();

    if (sessionNowError) throw sessionNowError;

    if (!sessionNow.session?.user) {
      throw new Error("Не удалось создать сессию.");
    }

    currentUser = sessionNow.session.user;

    if (!telegramInitData()) {
      throw new Error("Откройте планер через Telegram.");
    }

    const {
      data: authData,
      error: authError
    } = await db.functions.invoke("telegram-auth", {
      body: {
        initData: telegramInitData()
      }
    });

    if (authError) throw authError;

    if (authData?.error) {
      throw new Error(authData.error);
    }

    await loadProfile();

    await ensureProject();

    await loadAll();

    setupRealtime();

    startAutoRefresh();

    showApp();

  } catch (error) {
    console.error("BOOT ERROR", error);

    showAuthError(
      error?.message ||
      "Не удалось открыть планер."
    );
  }
}


/* =========================================================
   ПРОФИЛЬ
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

  if (error) throw error;

  if (!data) {
    throw new Error("Профиль Telegram не найден.");
  }

  currentProfile = data;

  const avatar = $("userAvatar");

  if (!avatar) return;

  if (data.telegram_photo_url) {
    avatar.innerHTML = `
      <img
        src="${esc(data.telegram_photo_url)}"
        alt=""
      >
    `;
  } else {
    avatar.textContent =
      (data.telegram_first_name || "?")
        .slice(0, 2)
        .toUpperCase();
  }
}


/* =========================================================
   ПРОЕКТ
   ========================================================= */

async function ensureProject() {
  let {
    data,
    error
  } = await db
    .from("projects")
    .select("*")
    .order("created_at", {
      ascending: true
    })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    const {
      data: created,
      error: createError
    } = await db.rpc("create_default_project");

    if (createError) throw createError;

    data = Array.isArray(created)
      ? created[0]
      : created;
  }

  if (!data) {
    throw new Error("Не найден проект команды.");
  }

  currentProject = data;

  const {
    error: memberError
  } = await db
    .from("project_members")
    .upsert(
      {
        project_id: currentProject.id,
        user_id: currentUser.id
      },
      {
        onConflict: "project_id,user_id",
        ignoreDuplicates: true
      }
    );

  if (memberError) {
    console.warn(
      "PROJECT MEMBERSHIP",
      memberError.message
    );
  }
}


/* =========================================================
   ЗАГРУЗКА ДАННЫХ
   ========================================================= */

async function loadAll() {
  await Promise.all([
    loadMembers(),
    loadContent()
  ]);

  renderEverything();
}


async function loadMembers() {
  const {
    data,
    error
  } = await db
    .from("profiles")
    .select(`
      id,
      telegram_id,
      telegram_username,
      telegram_first_name,
      telegram_photo_url
    `)
    .not("telegram_id", "is", null)
    .order("telegram_first_name", {
      ascending: true
    });

  if (error) {
    console.warn(
      "MEMBERS",
      error.message
    );

    return;
  }

  members = data || [];

  renderTeam();
}


async function loadContent() {
  if (!currentProject) return;

  const {
    data: contentData,
    error: contentError
  } = await db
    .from("content")
    .select("*")
    .eq("project_id", currentProject.id)
    .order("created_at", {
      ascending: false
    });

  if (contentError) throw contentError;


  const {
    data: publicationData,
    error: publicationError
  } = await db
    .from("publications")
    .select("*")
    .eq("project_id", currentProject.id)
    .order("publication_date", {
      ascending: true
    })
    .order("publication_time", {
      ascending: true,
      nullsFirst: false
    });

  if (publicationError) {
    throw publicationError;
  }


  const publicationIds =
    (publicationData || []).map(
      item => item.id
    );

  let assignees = [];


  if (publicationIds.length) {
    const {
      data,
      error
    } = await db
      .from("publication_assignees")
      .select("publication_id,user_id")
      .in(
        "publication_id",
        publicationIds
      );

    if (error) throw error;

    assignees = data || [];
  }


  contents = contentData || [];

  publications = publicationData || [];

  assigneeRows = assignees;
}


/* =========================================================
   REALTIME
   ========================================================= */

function setupRealtime() {
  realtimeChannels.forEach(
    channel => db.removeChannel(channel)
  );

  realtimeChannels = [];


  [
    "content",
    "publications",
    "publication_assignees"
  ].forEach(table => {

    const channel = db
      .channel(
        `media-planner-${table}`
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
            console.error(
              "REALTIME",
              error
            );
          }

        }
      )
      .subscribe();

    realtimeChannels.push(channel);
  });
}


/* =========================================================
   АВТООБНОВЛЕНИЕ
   ========================================================= */

function startAutoRefresh() {
  clearInterval(refreshTimer);

  refreshTimer = setInterval(
    async () => {

      if (
        refreshing ||
        document.hidden
      ) {
        return;
      }

      refreshing = true;

      try {

        await Promise.all([
          loadMembers(),
          loadContent()
        ]);

        renderEverything();

      } catch (error) {

        console.warn(
          "AUTO REFRESH",
          error
        );

      } finally {

        refreshing = false;

      }

    },
    15000
  );
}


/* =========================================================
   ЭКРАН ПРИЛОЖЕНИЯ
   ========================================================= */

function showApp() {
  $("authScreen")?.classList.add(
    "hidden"
  );

  $("app")?.classList.remove(
    "hidden"
  );

  switchView("calendarView");
}


function showAuthError(message) {
  const card =
    document.querySelector(
      ".auth-card"
    );

  if (!card) return;

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
   РЕНДЕР
   ========================================================= */

function renderEverything() {
  renderCalendar();
  renderUpcoming();
  renderContent();
  renderTeam();
  renderAnalytics();
}


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
        button.dataset.view === viewId
      );

    });


  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}


/* =========================================================
   КАЛЕНДАРЬ
   ========================================================= */

function renderCalendar() {

  const grid = $("calendarGrid");

  if (!grid) return;


  const year =
    currentMonth.getFullYear();

  const month =
    currentMonth.getMonth();


  $("monthLabel").textContent =
    `${monthNames[month]} ${year}`;


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


  const offset =
    (firstDay.getDay() + 6) % 7;


  const totalCells =
    Math.ceil(
      (offset + daysInMonth) / 7
    ) * 7;


  grid.innerHTML = "";


  for (
    let index = 0;
    index < totalCells;
    index++
  ) {

    const cell =
      document.createElement("div");

    cell.className =
      "calendar-day";


    const dayNumber =
      index - offset + 1;


    let date;
    let displayedDay;


    if (dayNumber < 1) {

      const dateObject =
        new Date(
          year,
          month,
          dayNumber
        );

      date = toISO(dateObject);

      displayedDay =
        dateObject.getDate();

      cell.classList.add(
        "other-month"
      );

    } else if (
      dayNumber > daysInMonth
    ) {

      const dateObject =
        new Date(
          year,
          month,
          dayNumber
        );

      date = toISO(dateObject);

      displayedDay =
        dateObject.getDate();

      cell.classList.add(
        "other-month"
      );

    } else {

      date =
        `${year}-${pad(month + 1)}-${pad(dayNumber)}`;

      displayedDay =
        dayNumber;
    }


    if (date === isoToday()) {

      cell.classList.add(
        "today"
      );

    }


    const number =
      document.createElement("div");

    number.className =
      "day-number";

    number.textContent =
      displayedDay;

    cell.appendChild(number);


    const list =
      publications
        .filter(
          publication =>
            publication.publication_date === date
        )
        .sort(sortPublication);


    const publicationBox =
      document.createElement("div");

    publicationBox.className =
      "calendar-publications";


    list
      .slice(0, 4)
      .forEach(publication => {

        const button =
          document.createElement("button");

        button.type = "button";

        button.className =
          "calendar-publication";

        button.dataset.platform =
          publication.platform;


        button.innerHTML = `
          <span class="pub-time">
            ${
              publication.publication_time
                ? esc(
                    publication.publication_time
                      .slice(0, 5)
                  )
                : ""
            }
          </span>

          <span class="pub-title">
            ${esc(publication.platform)}
            ·
            ${esc(publication.title)}
          </span>
        `;


        button.addEventListener(
          "click",
          event => {

            event.stopPropagation();

            openModal(
              publication.content_id
            );

          }
        );


        publicationBox.appendChild(
          button
        );

      });


    if (list.length > 4) {

      const more =
        document.createElement("div");

      more.className =
        "more-publications";

      more.textContent =
        `+ ещё ${list.length - 4}`;

      publicationBox.appendChild(
        more
      );

    }


    cell.appendChild(
      publicationBox
    );

    grid.appendChild(
      cell
    );

  }
}


function toISO(date) {

  return `
    ${date.getFullYear()}-
    ${pad(date.getMonth() + 1)}-
    ${pad(date.getDate())}
  `.replace(/\s/g, "");

}


/* =========================================================
   ОТВЕТСТВЕННЫЕ
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
            member.id === row.user_id
        )
    )
    .filter(Boolean);

}


/* =========================================================
   БЛИЖАЙШИЕ ПУБЛИКАЦИИ
   ========================================================= */

function renderUpcoming() {

  const box =
    $("upcomingList");

  if (!box) return;


  const now =
    new Date();


  const upcoming =
    publications
      .filter(
        publication =>
          publicationDateTime(
            publication
          ) >= now
      )
      .sort(sortPublication)
      .slice(0, 6);


  if (!upcoming.length) {

    box.innerHTML = `
      <div class="empty-state">

        <strong>
          Пока нет публикаций
        </strong>

        Добавь первый контент
        через «+ Контент».

      </div>
    `;

    return;
  }


  box.innerHTML =
    upcoming.map(
      publication => {

        const date =
          publication
            .publication_date
            .split("-")
            .map(Number);


        const assignees =
          publicationAssignees(
            publication.id
          );


        return `
          <button
            type="button"
            class="upcoming-card"
            data-publication-id="${esc(publication.id)}"
          >

            <div class="upcoming-date">

              <span class="upcoming-date-day">
                ${date[2]}
              </span>

              <span class="upcoming-date-month">
                ${shortMonths[date[1] - 1]}
              </span>

            </div>


            <div
              class="
                upcoming-platform
                ${platformClass(publication.platform)}
              "
            >
              ${platformShort(publication.platform)}
            </div>


            <div class="upcoming-info">

              <div class="upcoming-title">
                ${esc(publication.title)}
              </div>

              <div class="upcoming-meta">

                ${esc(publication.platform)}
                ·
                ${esc(publication.format)}

                ${
                  publication.publication_time
                    ? ` · ${esc(
                        publication.publication_time
                          .slice(0, 5)
                      )}`
                    : ""
                }

              </div>


              <div class="upcoming-assignees">

                ${assignees
                  .slice(0, 4)
                  .map(
                    member =>
                      avatarHtml(member)
                  )
                  .join("")}

              </div>

            </div>


            <div class="upcoming-chevron">
              ›
            </div>

          </button>
        `;
      }
    ).join("");


  box
    .querySelectorAll(
      "[data-publication-id]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const publication =
            publications.find(
              item =>
                item.id ===
                button.dataset
                  .publicationId
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
   КОНТЕНТ
   ========================================================= */

function renderContent() {

  const box =
    $("contentList");

  if (!box) return;


  if (!contents.length) {

    box.innerHTML = `
      <div class="empty-state">

        <strong>
          Контента пока нет
        </strong>

        Создай первый контент —
        внутри можно сразу добавить
        несколько публикаций.

      </div>
    `;

    return;
  }


  const sortedContents =
    [...contents].sort(
      (a, b) => {

        const aDate =
          publications
            .filter(
              p =>
                p.content_id === a.id
            )
            .sort(sortPublication)[0];


        const bDate =
          publications
            .filter(
              p =>
                p.content_id === b.id
            )
            .sort(sortPublication)[0];


        if (!aDate && !bDate) {
          return 0;
        }

        if (!aDate) return 1;

        if (!bDate) return -1;

        return sortPublication(
          aDate,
          bDate
        );

      }
    );


  box.innerHTML =
    sortedContents.map(
      content => {

        const contentPublications =
          publications
            .filter(
              publication =>
                publication.content_id ===
                content.id
            )
            .sort(sortPublication);


        return `
          <article
            class="content-card"
            data-content-id="${esc(content.id)}"
          >

            <div class="content-card-head">

              <div>

                <h3 class="content-card-title">
                  ${esc(content.title)}
                </h3>

                ${
                  content.description
                    ? `
                      <p class="content-card-description">
                        ${esc(content.description)}
                      </p>
                    `
                    : ""
                }

              </div>

            </div>


            <div class="content-publications">

              ${
                contentPublications
                  .map(
                    publication => `
                      <div class="content-publication-row">

                        <span
                          class="
                            platform-dot
                            ${platformClass(publication.platform)}
                          "
                        ></span>


                        <div class="content-publication-main">

                          <div class="content-publication-title">

                            ${esc(publication.platform)}
                            ·
                            ${esc(publication.title)}

                          </div>


                          <div class="content-publication-meta">

                            ${formatDate(
                              publication.publication_date
                            )}

                            ${
                              publication.publication_time
                                ? ` · ${esc(
                                    publication.publication_time
                                      .slice(0, 5)
                                  )}`
                                : ""
                            }

                            ·

                            ${esc(publication.format)}

                          </div>

                        </div>


                        <span
                          class="
                            status
                            ${esc(publication.status)}
                          "
                        >
                          ${statusLabel(
                            publication.status
                          )}
                        </span>

                      </div>
                    `
                  )
                  .join("")
              }

            </div>

          </article>
        `;
      }
    ).join("");


  box
    .querySelectorAll(
      "[data-content-id]"
    )
    .forEach(card => {

      card.addEventListener(
        "click",
        () =>
          openModal(
            card.dataset.contentId
          )
      );

    });

}


function statusLabel(status) {

  return {
    planned: "Запланировано",
    progress: "В работе",
    done: "Готово"
  }[status] || "Запланировано";

}


/* =========================================================
   КОМАНДА
   ========================================================= */

function renderTeam() {

  const box =
    $("teamList");

  const count =
    $("teamCount");

  if (!box) return;


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
      <div class="empty-state">

        <strong>
          Участников пока нет
        </strong>

        Пользователи появятся здесь
        после входа через Telegram.

      </div>
    `;

    return;
  }


  box.innerHTML =
    members.map(
      member => `
        <article class="team-card">

          ${avatarHtml(member)}

          <div class="team-info">

            <div class="team-name">
              ${
                esc(
                  member.telegram_first_name ||
                  "Без имени"
                )
              }
            </div>

            <div class="team-username">

              ${
                member.telegram_username
                  ? `@${esc(
                      member.telegram_username
                    )}`
                  : "Telegram"
              }

            </div>

          </div>

        </article>
      `
    ).join("");

}


/* =========================================================
   АНАЛИТИКА
   ========================================================= */

function renderAnalytics() {

  const list =
    analyticsPeriod();


  const total =
    $("statTotal");

  const weekly =
    $("statWeek");


  if (total) {
    total.textContent =
      list.length;
  }


  if (weekly) {

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


    weekly.textContent =
      (
        list.length /
        days *
        7
      ).toFixed(1);

  }


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
    publication => {

      const date =
        new Date(
          `${publication.publication_date}T12:00:00`
        );


      const key =
        weekdayNames[
          date.getDay()
        ];


      weekdays[key] =
        (weekdays[key] || 0) + 1;

    }
  );


  renderBars(
    "weekdayStats",
    weekdays
  );


  const workload = {};


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


          workload[name] =
            (workload[name] || 0) + 1;

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

  let from = null;


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


  return publications.filter(
    publication => {

      const date =
        new Date(
          `${publication.publication_date}T12:00:00`
        );

      return !from || date >= from;

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
        "Другое";


      result[value] =
        (result[value] || 0) + 1;


      return result;

    },
    {}
  );

}


function renderBars(
  id,
  data
) {

  const box =
    $(id);

  if (!box) return;


  const entries =
    Object.entries(data)
      .sort(
        (a, b) =>
          b[1] - a[1]
      );


  const max =
    entries[0]?.[1] || 1;


  if (!entries.length) {

    box.innerHTML = `
      <div
        class="empty-state"
        style="
          padding:18px;
          box-shadow:none;
        "
      >
        Нет данных
      </div>
    `;

    return;
  }


  box.innerHTML =
    entries.map(
      ([name, count]) => `

        <div class="analytics-bar-row">

          <div class="analytics-bar-top">

            <span>
              ${esc(name)}
            </span>

            <span>
              ${count}
            </span>

          </div>


          <div class="analytics-bar">

            <div
              class="analytics-bar-fill"
              style="
                width:${Math.max(
                  4,
                  count / max * 100
                )}%
              "
            ></div>

          </div>

        </div>

      `
    ).join("");

}


/* =========================================================
   ВСПОМОГАТЕЛЬНЫЕ
   ========================================================= */

function minDate(list) {

  if (!list.length) {
    return isoToday();
  }

  return list.reduce(
    (min, item) =>
      min < item.publication_date
        ? min
        : item.publication_date,
    list[0].publication_date
  );

}


function maxDate(list) {

  if (!list.length) {
    return isoToday();
  }

  return list.reduce(
    (max, item) =>
      max > item.publication_date
        ? max
        : item.publication_date,
    list[0].publication_date
  );

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
  number,
  one,
  few,
  many
) {

  const mod10 =
    number % 10;

  const mod100 =
    number % 100;


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
   МОДАЛЬНОЕ ОКНО
   ========================================================= */

function openModal(
  contentId = null
) {

  const modal =
    $("modal");

  if (!modal) return;


  modal.classList.remove(
    "hidden"
  );


  document.body.style.overflow =
    "hidden";


  $("editingContentId").value =
    contentId || "";


  $("modalTitle").textContent =
    contentId
      ? "Редактировать контент"
      : "Новый контент";


  $("deleteContentBtn")
    .classList
    .toggle(
      "hidden",
      !contentId
    );


  $("contentTitle").value =
    "";

  $("contentDescription").value =
    "";

  $("publicationEditorList")
    .innerHTML = "";


  if (contentId) {

    const content =
      contents.find(
        item =>
          item.id === contentId
      );


    if (content) {

      $("contentTitle").value =
        content.title || "";

      $("contentDescription").value =
        content.description || "";

    }


    publications
      .filter(
        publication =>
          publication.content_id ===
          contentId
      )
      .sort(sortPublication)
      .forEach(
        addPublicationEditor
      );


    if (
      !$(
        "publicationEditorList"
      ).children.length
    ) {

      addPublicationEditor();

    }

  } else {

    addPublicationEditor();

  }

}


function closeModal() {

  $("modal")
    ?.classList
    .add("hidden");

  document.body.style.overflow =
    "";

}


/* =========================================================
   ДОБАВЛЕНИЕ ПУБЛИКАЦИИ
   ========================================================= */

function addPublicationEditor(
  data = null
) {

  const template =
    $("publicationTemplate");

  const list =
    $("publicationEditorList");


  if (!template || !list) {
    return;
  }


  const node =
    template
      .content
      .firstElementChild
      .cloneNode(true);


  node.dataset.existingId =
    data?.id || "";


  const defaults = {

    title: "",

    platform: "Telegram",

    format: "Пост",

    date: isoToday(),

    time: "",

    status: "planned",

    link: "",

    description: ""

  };


  node
    .querySelectorAll(
      "[data-field]"
    )
    .forEach(
      field => {

        const key =
          field.dataset.field;

        field.value =
          data?.[key] ??
          defaults[key];

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


      const options =
        node.querySelector(
          "[data-options]"
        );


      const filtered =
        members.filter(
          member => {

            const name =
              (
                member.telegram_first_name ||
                ""
              ).toLowerCase();


            const username =
              (
                member.telegram_username ||
                ""
              ).toLowerCase();


            return (
              name.includes(search) ||
              username.includes(search)
            );

          }
        );


      if (!filtered.length) {

        options.innerHTML = `
          <div
            style="
              padding:10px;
              color:#999;
              font-size:12px;
            "
          >
            Ничего не найдено
          </div>
        `;

      } else {

        options.innerHTML =
          filtered.map(
            member => `

              <label class="assignee-option">

                <input
                  type="checkbox"
                  data-user="${esc(member.id)}"
                  ${
                    selected.has(member.id)
                      ? "checked"
                      : ""
                  }
                >

                <span class="assignee-option-name">

                  ${esc(
                    member.telegram_first_name ||
                    "Без имени"
                  )}

                  ${
                    member.telegram_username
                      ? ` · @${esc(
                          member.telegram_username
                        )}`
                      : ""
                  }

                </span>

              </label>

            `
          ).join("");

      }


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


      const selectedBox =
        node.querySelector(
          "[data-selected]"
        );


      selectedBox.innerHTML =
        [...selected]
          .map(
            id =>
              members.find(
                member =>
                  member.id === id
              )
          )
          .filter(Boolean)
          .map(
            member => `

              <span class="assignee-tag">

                ${esc(
                  member.telegram_first_name ||
                  "Участник"
                )}

                <button
                  type="button"
                  data-remove="${esc(member.id)}"
                >
                  ×
                </button>

              </span>

            `
          )
          .join("");


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
    .addEventListener(
      "click",
      () => {

        const count =
          list.querySelectorAll(
            "[data-publication]"
          ).length;


        if (count <= 1) {

          toast(
            "Должна остаться хотя бы одна публикация"
          );

          return;

        }


        node.remove();

        renumberEditors();

      }
    );


  list.appendChild(node);

  renumberEditors();

}


function renumberEditors() {

  document
    .querySelectorAll(
      "[data-publication] .pub-number"
    )
    .forEach(
      (element, index) => {

        element.textContent =
          `Публикация ${index + 1}`;

      }
    );

}


/* =========================================================
   ЧТЕНИЕ ПУБЛИКАЦИИ
   ========================================================= */

function readPublicationNode(
  node
) {

  const get =
    field =>
      node
        .querySelector(
          `[data-field="${field}"]`
        )
        .value;


  return {

    content_id:
      $("editingContentId").value ||
      null,

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
      node
        .querySelector(
          '[data-reminder="24h"]'
        )
        .checked,

    reminder_3h:
      node
        .querySelector(
          '[data-reminder="3h"]'
        )
        .checked,

    reminder_1h:
      node
        .querySelector(
          '[data-reminder="1h"]'
        )
        .checked

  };

}


/* =========================================================
   СОХРАНЕНИЕ
   ========================================================= */

async function saveContent(
  event
) {

  event.preventDefault();


  if (
    !currentProject ||
    !currentUser
  ) {
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


  const description =
    $("contentDescription")
      .value
      .trim();


  if (!title) {

    toast(
      "Напиши название контента"
    );

    return;
  }


  const editorNodes =
    [
      ...document.querySelectorAll(
        "[data-publication]"
      )
    ];


  if (!editorNodes.length) {

    toast(
      "Добавь хотя бы одну публикацию"
    );

    return;
  }


  for (
    const node of editorNodes
  ) {

    const publication =
      readPublicationNode(node);


    if (!publication.title) {

      toast(
        "У каждой публикации должно быть название"
      );

      node
        .querySelector(
          '[data-field="title"]'
        )
        ?.focus();

      return;
    }


    if (
      !publication.publication_date
    ) {

      toast(
        "У каждой публикации должна быть дата"
      );

      return;
    }

  }


  let savedContent;


  if (contentId) {

    const {
      data,
      error
    } = await db
      .from("content")
      .update({
        title,
        description
      })
      .eq("id", contentId)
      .select()
      .single();


    if (error) throw error;

    savedContent = data;

  } else {

    const {
      data,
      error
    } = await db
      .from("content")
      .insert({
        project_id:
          currentProject.id,

        title,

        description,

        created_by:
          currentUser.id
      })
      .select()
      .single();


    if (error) throw error;

    savedContent = data;

  }


  const keptIds = [];


  for (
    const node of editorNodes
  ) {

    const payload =
      readPublicationNode(node);


    payload.content_id =
      savedContent.id;


    const existingId =
      node.dataset.existingId;


    let publication;
    let error;


    if (existingId) {

      ({
        data: publication,
        error
      } = await db
        .from("publications")
        .update(payload)
        .eq("id", existingId)
        .select()
        .single());

    } else {

      ({
        data: publication,
        error
      } = await db
        .from("publications")
        .insert(payload)
        .select()
        .single());

    }


    if (error) throw error;


    keptIds.push(
      publication.id
    );


    const {
      error: deleteAssigneeError
    } = await db
      .from("publication_assignees")
      .delete()
      .eq(
        "publication_id",
        publication.id
      );


    if (deleteAssigneeError) {
      throw deleteAssigneeError;
    }


    const selected =
      [...node._selected];


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
        error: assigneeError
      } = await db
        .from("publication_assignees")
        .insert(rows);


      if (assigneeError) {
        throw assigneeError;
      }

    }

  }


  if (contentId) {

    const removedIds =
      publications
        .filter(
          publication =>
            publication.content_id ===
            contentId
        )
        .filter(
          publication =>
            !keptIds.includes(
              publication.id
            )
        )
        .map(
          publication =>
            publication.id
        );


    if (removedIds.length) {

      const {
        error
      } = await db
        .from("publications")
        .delete()
        .in(
          "id",
          removedIds
        );


      if (error) throw error;

    }

  }


  closeModal();

  await loadContent();

  renderEverything();

  toast("Сохранено");

}


/* =========================================================
   УДАЛЕНИЕ
   ========================================================= */

async function deleteContent() {

  const id =
    $("editingContentId")
      .value;


  if (!id) return;


  const confirmed =
    window.confirm(
      "Удалить этот контент и все его публикации?"
    );


  if (!confirmed) return;


  const {
    error
  } = await db
    .from("content")
    .delete()
    .eq("id", id);


  if (error) {

    console.error(error);

    toast(
      "Не удалось удалить"
    );

    return;
  }


  closeModal();

  await loadContent();

  renderEverything();

  toast("Удалено");

}


/* =========================================================
   СОБЫТИЯ
   ========================================================= */

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


  $("addContentTop")
    ?.addEventListener(
      "click",
      () =>
        openModal()
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


  $("contentForm")
    ?.addEventListener(
      "submit",
      event => {

        saveContent(event)
          .catch(error => {

            console.error(
              "SAVE",
              error
            );

            toast(
              error?.message ||
              "Ошибка сохранения"
            );

          });

      }
    );


  $("deleteContentBtn")
    ?.addEventListener(
      "click",
      () => {

        deleteContent()
          .catch(error => {

            console.error(
              "DELETE",
              error
            );

            toast(
              error?.message ||
              "Ошибка удаления"
            );

          });

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


  document.addEventListener(
    "keydown",
    event => {

      if (
        event.key === "Escape" &&
        !$("modal")
          ?.classList
          .contains("hidden")
      ) {

        closeModal();

      }

    }
  );

}


/* =========================================================
   START
   ========================================================= */

bindEvents();

boot();
