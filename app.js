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

let realtimeChannels = [];
let memberPoll = null;
let plannerPoll = null;

let saving = false;


/* =========================
   HELPERS
========================= */

const $ = id =>
  document.getElementById(id);


const esc = (value = "") =>
  String(value).replace(
    /[&<>"']/g,
    c => ({
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


function telegramInitData() {
  return tg?.initData || "";
}


function toast(text) {

  const old =
    document.querySelector(".toast");

  if (old) old.remove();

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


function formatDate(date) {

  if (!date) return "";

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


function statusLabel(status) {

  if (
    status === "progress"
  ) {
    return "В работе";
  }

  if (
    status === "done"
  ) {
    return "Готово";
  }

  return "Запланировано";
}


function sortPublication(a, b) {

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

  return aa.localeCompare(bb);
}


function plural(
  n,
  one,
  few,
  many
) {

  const m = n % 10;
  const t = n % 100;

  if (
    m === 1 &&
    t !== 11
  ) {
    return one;
  }

  if (
    m >= 2 &&
    m <= 4 &&
    (t < 12 || t > 14)
  ) {
    return few;
  }

  return many;
}


function toISO(date) {

  return `${date.getFullYear()}-${pad(
    date.getMonth() + 1
  )}-${pad(
    date.getDate()
  )}`;
}


/* =========================
   BOOT
========================= */

async function boot() {

  try {

    tg?.ready();
    tg?.expand();

    tg?.enableClosingConfirmation?.();

    tg?.setHeaderColor?.(
      "#f7f7f5"
    );

    tg?.setBackgroundColor?.(
      "#f7f7f5"
    );


    /* SUPABASE SESSION */

    let sessionData =
      await db.auth.getSession();

    let session =
      sessionData.data.session;


    if (!session) {

      const {
        error
      } =
        await db.auth.signInAnonymously();

      if (error) {
        throw error;
      }

      session =
        (
          await db.auth.getSession()
        ).data.session;
    }


    currentUser =
      session?.user;


    if (!currentUser) {

      throw new Error(
        "Не удалось создать рабочую сессию."
      );
    }


    /* TELEGRAM */

    const initData =
      telegramInitData();


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


/* =========================
   PROFILE
========================= */

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
    data || {
      id: currentUser.id,
      telegram_first_name:
        "Участник"
    };
}


/* =========================
   PROJECT
========================= */

async function ensureProject() {

  /*
   * Сначала пробуем новую RPC.
   *
   * Если Supabase отвечает:
   * "Could not find the function..."
   * или schema cache ещё не обновился,
   * используем старую create_default_project().
   */

  let result =
    await db.rpc(
      "get_default_project_for_user"
    );


  if (
    !result.error &&
    result.data
  ) {

    currentProject =
      Array.isArray(result.data)
        ? result.data[0]
        : result.data;

    if (currentProject) {
      return;
    }
  }


  console.warn(
    "get_default_project_for_user unavailable:",
    result.error
  );


  /*
   * FALLBACK
   *
   * Существующая функция
   * create_default_project()
   * создаёт/возвращает рабочий
   * проект и добавляет пользователя.
   */

  const fallback =
    await db.rpc(
      "create_default_project"
    );


  if (
    fallback.error
  ) {

    throw new Error(
      fallback.error.message ||
      "Не удалось получить проект команды."
    );
  }


  currentProject =
    Array.isArray(
      fallback.data
    )
      ? fallback.data[0]
      : fallback.data;


  /*
   * Иногда RPC возвращает только id.
   * В таком случае пробуем найти проект.
   */

  if (
    !currentProject ||
    !currentProject.id
  ) {

    const {
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

    currentProject =
      data;
  }


  if (!currentProject) {

    throw new Error(
      "Не найден проект команды."
    );
  }
}


/* =========================
   LOAD ALL
========================= */

async function loadAll() {

  await Promise.all([
    loadMembers(),
    loadContent()
  ]);

  renderEverything();
}


/* =========================
   MEMBERS
========================= */

async function loadMembers() {

  const {
    data,
    error
  } =
    await db
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
      "members:",
      error.message
    );

    members =
      currentProfile
        ? [currentProfile]
        : [];

    renderTeam();

    return;
  }


  members =
    data || [];


  if (
    currentProfile &&
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


  renderTeam();
}


/* =========================
   CONTENT
========================= */

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


/* =========================
   REALTIME
========================= */

function setupRealtime() {

  realtimeChannels.forEach(
    channel =>
      db.removeChannel(
        channel
      )
  );


  realtimeChannels = [];


  [
    "content",
    "publications",
    "publication_assignees"
  ].forEach(
    table => {

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
                  "Realtime:",
                  error
                );
              }
            }
          )
          .subscribe();


      realtimeChannels.push(
        channel
      );
    }
  );
}


/* =========================
   POLLING
========================= */

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

        } catch (error) {

          console.warn(
            "Members refresh:",
            error
          );
        }

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
            "Planner refresh:",
            error
          );
        }

      },
      15000
    );
}


/* =========================
   SHOW APP
========================= */

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


  if (!card) return;


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


/* =========================
   RENDER EVERYTHING
========================= */

function renderEverything() {

  renderCalendar();

  renderUpcoming();

  renderContent();

  renderTeam();

  renderAnalytics();
}


/* =========================
   NAVIGATION
========================= */

function switchView(
  viewId
) {

  document
    .querySelectorAll(
      ".view"
    )
    .forEach(
      view => {

        view.classList.toggle(
          "active",
          view.id ===
          viewId
        );
      }
    );


  document
    .querySelectorAll(
      ".nav-item"
    )
    .forEach(
      button => {

        button.classList.toggle(
          "active",
          button.dataset.view ===
          viewId
        );
      }
    );


  window.scrollTo({
    top: 0,
    behavior: "instant"
  });
}


/* =========================
   CALENDAR
========================= */

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
      day >
      daysInMonth
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
        `${year}-${pad(month + 1)}-${pad(day)}`;

      shownDay =
        day;
    }


    cell.dataset.date =
      date;


    const isToday =
      date ===
      isoToday();


    cell.innerHTML =
      `
        <div
          class="day-number ${
            isToday
              ? "today"
              : ""
          }"
        >
          ${shownDay}
        </div>
      `;


    cell.addEventListener(
      "click",
      () =>
        openDayDetails(
          date
        )
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
      .slice(0, 3)
      .forEach(
        p => {

          const chip =
            document.createElement(
              "button"
            );


          chip.type =
            "button";


          chip.className =
            `
              pub-chip
              ${platformClass(
                p.platform
              )}
              ${
                p.status === "done"
                  ? "done"
                  : ""
              }
            `;


          chip.innerHTML =
            `
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

              ${esc(p.title)}
            `;


          chip.title =
            `${p.platform} · ${p.format} · ${p.title}`;


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
        }
      );


    if (
      dayPubs.length >
      3
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
          dayPubs.length - 3
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


/* =========================
   DAY MODAL
========================= */

function openDayDetails(
  date
) {

  const pubs =
    publications
      .filter(
        p =>
          p.publication_date ===
          date
      )
      .sort(
        sortPublication
      );


  const d =
    new Date(
      `${date}T12:00:00`
    );


  $("dayModalEyebrow")
    .textContent =
      `${d.getDate()} ${
        shortMonths[
          d.getMonth()
        ]
      } ${d.getFullYear()}`;


  $("dayModalTitle")
    .textContent =
      pubs.length
        ? `${pubs.length} ${
            plural(
              pubs.length,
              "публикация",
              "публикации",
              "публикаций"
            )
          }`
        : "Пока пусто";


  $("dayModalSubtitle")
    .textContent =
      pubs.length
        ? "Расписание публикаций на эту дату"
        : "На эту дату ещё ничего не запланировано";


  $("addPublicationForDay")
    .dataset.date =
      date;


  const box =
    $("dayPublicationList");


  if (!pubs.length) {

    box.innerHTML =
      `
        <div class="empty">
          Добавь первую публикацию на этот день.
        </div>
      `;

  } else {

    box.innerHTML =
      pubs
        .map(
          p => {

            const assignees =
              publicationAssignees(
                p.id
              );


            const avatars =
              assignees
                .slice(0, 3)
                .map(
                  m =>
                    avatarHtml(m)
                )
                .join("");


            return `
              <button
                type="button"
                class="day-publication"
                data-day-pub="${p.id}"
              >

                <div
                  class="day-pub-time"
                >
                  ${
                    p.publication_time
                      ? esc(
                          p.publication_time
                            .slice(0, 5)
                        )
                      : "—"
                  }
                </div>

                <span
                  class="platform-dot ${
                    platformClass(
                      p.platform
                    )
                  }"
                ></span>

                <div
                  class="day-pub-main"
                >

                  <div
                    class="day-pub-title"
                  >
                    ${esc(p.title)}
                  </div>

                  <div
                    class="day-pub-meta"
                  >
                    ${esc(p.platform)}
                    ·
                    ${esc(p.format)}
                  </div>

                </div>

                <div
                  class="assignee-mini"
                >
                  ${avatars}
                </div>

                <span
                  class="chevron"
                >
                  ›
                </span>

              </button>
            `;
          }
        )
        .join("");


    box
      .querySelectorAll(
        "[data-day-pub]"
      )
      .forEach(
        button => {

          button.addEventListener(
            "click",
            () => {

              const p =
                publications.find(
                  x =>
                    x.id ===
                    button.dataset
                      .dayPub
                );


              closeDayDetails();


              if (p) {

                openModal(
                  p.content_id
                );
              }
            }
          );
        }
      );
  }


  $("dayModal")
    .classList
    .remove("hidden");


  requestAnimationFrame(
    () => {

      document
        .querySelector(
          "#dayModal .modal-sheet"
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
    .classList
    .add("hidden");
}


/* =========================
   UPCOMING
========================= */

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


  if (!upcoming.length) {

    box.innerHTML =
      `
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

          const assignees =
            publicationAssignees(
              p.id
            ).slice(
              0,
              3
            );


          const avatars =
            assignees
              .map(
                m =>
                  avatarHtml(m)
              )
              .join("");


          return `
            <button
              class="upcoming-card"
              data-pub="${p.id}"
              type="button"
            >

              <div
                class="date-box"
              >

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


              <span
                class="platform-dot ${
                  platformClass(
                    p.platform
                  )
                }"
              ></span>


              <div
                class="upcoming-main"
              >

                <div
                  class="upcoming-title"
                >
                  ${esc(p.title)}
                </div>

                <div
                  class="upcoming-meta"
                >
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
                </div>

              </div>


              <div
                class="assignee-mini"
              >
                ${avatars}
              </div>


              <span
                class="chevron"
              >
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
      button => {

        button.addEventListener(
          "click",
          () => {

            const p =
              publications.find(
                x =>
                  x.id ===
                  button.dataset
                    .pub
              );


            if (p) {

              openModal(
                p.content_id
              );
            }
          }
        );
      }
    );
}


/* =========================
   CONTENT LIST
========================= */

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
      c => {

        const pubs =
          publications.filter(
            p =>
              p.content_id ===
              c.id
          );


        const haystack =
          [
            c.title || "",
            c.description || "",
            ...pubs.flatMap(
              p => [
                p.title,
                p.platform,
                p.format,
                p.description ||
                  ""
              ]
            )
          ]
            .join(" ")
            .toLowerCase();


        return (
          (
            !search ||
            haystack.includes(
              search
            )
          ) &&
          (
            platform ===
              "all" ||
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

    const message =
      contents.length
        ? "По выбранным фильтрам ничего не найдено."
        : "Контента пока нет. Нажми «+ Контент», чтобы добавить.";


    box.innerHTML =
      `
        <div class="empty">
          ${message}
        </div>
      `;

    return;
  }


  box.innerHTML =
    filtered
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


          const firstDate =
            pubs[0]
              ?.publication_date
              ? formatDate(
                  pubs[0]
                    .publication_date
                )
              : "Без даты";


          return `
            <article
              class="content-card"
              data-content="${c.id}"
            >

              <div
                class="content-card-head"
              >

                <div
                  class="content-main"
                >

                  <div
                    class="content-title"
                  >
                    ${esc(c.title)}
                  </div>


                  ${
                    c.description
                      ? `
                        <div
                          class="content-description"
                        >
                          ${esc(
                            c.description
                          )}
                        </div>
                      `
                      : ""
                  }


                  <div
                    class="content-meta"
                  >
                    ${pubs.length}
                    ${
                      plural(
                        pubs.length,
                        "публикация",
                        "публикации",
                        "публикаций"
                      )
                    }
                    ·
                    ${esc(firstDate)}
                  </div>

                </div>


                <span
                  class="chevron"
                >
                  ›
                </span>

              </div>


              <div
                class="content-publications"
              >

                ${
                  pubs.length

                    ? pubs
                        .map(
                          p => `
                            <button
                              class="content-publication"
                              data-publication-id="${p.id}"
                              type="button"
                            >

                              <span
                                class="platform-dot ${
                                  platformClass(
                                    p.platform
                                  )
                                }"
                              ></span>


                              <div
                                class="content-pub-main"
                              >

                                <div
                                  class="content-pub-title"
                                >
                                  ${esc(
                                    p.title
                                  )}
                                </div>


                                <div
                                  class="content-pub-meta"
                                >
                                  ${esc(
                                    p.platform
                                  )}
                                  ·
                                  ${esc(
                                    p.format
                                  )}
                                  ·
                                  ${formatDate(
                                    p.publication_date
                                  )}

                                  ${
                                    p.publication_time
                                      ? " · " +
                                        esc(
                                          p.publication_time
                                            .slice(0, 5)
                                        )
                                      : ""
                                  }
                                </div>

                              </div>


                              <span
                                class="status-pill ${
                                  p.status ===
                                  "progress"
                                    ? "progress"
                                    : p.status ===
                                      "done"
                                      ? "done"
                                      : ""
                                }"
                              >
                                ${statusLabel(
                                  p.status
                                )}
                              </span>


                              <span
                                class="chevron"
                              >
                                ›
                              </span>

                            </button>
                          `
                        )
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
        }
      )
      .join("");


  box
    .querySelectorAll(
      "[data-content]"
    )
    .forEach(
      card => {

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
      }
    );


  box
    .querySelectorAll(
      "[data-publication-id]"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          event => {

            event.stopPropagation();


            const p =
              publications.find(
                x =>
                  x.id ===
                  button.dataset
                    .publicationId
              );


            if (p) {

              openModal(
                p.content_id
              );
            }
          }
        );
      }
    );
}


/* =========================
   TEAM
========================= */

function renderTeam() {

  const box =
    $("teamList");


  $("teamCount")
    .textContent =
      `${members.length} ${
        plural(
          members.length,
          "участник",
          "участника",
          "участников"
        )
      }`;


  if (!members.length) {

    box.innerHTML =
      `
        <div class="empty">
          Участники появятся здесь после входа через Telegram.
        </div>
      `;

    return;
  }


  box.innerHTML =
    members
      .map(
        m => `
          <div
            class="team-card"
          >

            ${avatarHtml(m)}

            <div>

              <div
                class="team-name"
              >
                ${esc(
                  m.telegram_first_name ||
                  "Без имени"
                )}
              </div>

              <div
                class="team-handle"
              >
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


/* =========================
   ANALYTICS
========================= */

function analyticsPeriod() {

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
        6 *
        86400000
      );
  }


  if (
    activePeriod ===
    "month"
  ) {

    from =
      new Date(
        now.getTime() -
        29 *
        86400000
      );
  }


  if (
    activePeriod ===
    "3months"
  ) {

    from =
      new Date(
        now.getTime() -
        89 *
        86400000
      );
  }


  const platform =
    $("analyticsPlatform")
      ?.value ||
    "all";


  return publications.filter(
    p => {

      const d =
        new Date(
          `${p.publication_date}T12:00:00`
        );


      return (
        (
          !from ||
          d >= from
        ) &&
        (
          platform ===
            "all" ||
          p.platform ===
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
    (
      result,
      item
    ) => {

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
    )
      .sort(
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
                  <div
                    class="bar-row"
                  >

                    <span>
                      ${esc(name)}
                    </span>

                    <div
                      class="bar-track"
                    >

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


function renderAnalytics() {

  const list =
    analyticsPeriod();


  $("statTotal")
    .textContent =
      list.length;


  const days =
    activePeriod ===
      "week"
      ? 7
      : activePeriod ===
        "month"
        ? 30
        : activePeriod ===
          "3months"
          ? 90
          : Math.max(
              1,
              daysBetween(
                minDate(list),
                maxDate(list)
              ) + 1
            );


  $("statWeek")
    .textContent =
      (
        list.length /
        days *
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


  const weekdays =
    {};


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


  const workload =
    {};


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


function minDate(list) {

  return list.length
    ? list.reduce(
        (a, p) =>
          a <
          p.publication_date
            ? a
            : p.publication_date,
        list[0]
          .publication_date
      )
    : isoToday();
}


function maxDate(list) {

  return list.length
    ? list.reduce(
        (a, p) =>
          a >
          p.publication_date
            ? a
            : p.publication_date,
        list[0]
          .publication_date
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
    ) /
    86400000
  );
}


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


/* =========================
   EDITOR
========================= */

function openModal(
  contentId = null,
  presetDate = null
) {

  $("modal")
    .classList
    .remove("hidden");


  requestAnimationFrame(
    () => {

      document
        .querySelector(
          "#modal .modal-sheet"
        )
        ?.scrollTo({
          top: 0,
          behavior: "instant"
        });
    }
  );


  $("editingContentId")
    .value =
      contentId || "";


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
          c.title || "";


      $("contentDescription")
        .value =
          c.description || "";
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
    .add("hidden");
}


/* =========================
   PUBLICATION EDITOR
========================= */

function addPublicationEditor(
  data = null,
  presetDate = null
) {

  const template =
    $("publicationTemplate");


  const node =
    template
      .content
      .firstElementChild
      .cloneNode(true);


  node.dataset.existingId =
    data?.id || "";


  const fields =
    node.querySelectorAll(
      "[data-field]"
    );


  const values = {

    title: "",

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
    field => {

      field.value =
        data?.[
          field.dataset.field
        ] ??
        values[
          field.dataset.field
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


      const options =
        node.querySelector(
          "[data-options]"
        );


      const filtered =
        members.filter(
          m => {

            const name =
              (
                m.telegram_first_name ||
                ""
              )
                .toLowerCase();


            const username =
              (
                m.telegram_username ||
                ""
              )
                .toLowerCase();


            return (
              name.includes(
                search
              ) ||
              username.includes(
                search
              )
            );
          }
        );


      options.innerHTML =
        `
          <div
            class="assignee-options"
          >

            ${
              filtered
                .map(
                  m => `
                    <label
                      class="assignee-option"
                    >

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
                    checkbox
                      .dataset
                      .user
                  );

                } else {

                  selected.delete(
                    checkbox
                      .dataset
                      .user
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
                m =>
                  m.id ===
                  id
              )
          )
          .filter(Boolean)
          .map(
            m => `
              <span
                class="assignee-tag"
              >

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


      selectedBox
        .querySelectorAll(
          "[data-remove]"
        )
        .forEach(
          button => {

            button.onclick =
              () => {

                selected.delete(
                  button
                    .dataset
                    .remove
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
          document
            .querySelectorAll(
              "[data-publication]"
            )
            .length <= 1
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
        element,
        index
      ) => {

        element.textContent =
          `Публикация ${
            index + 1
          }`;
      }
    );
}


/* =========================
   SAVE
========================= */

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
      .value
      .trim();


  if (!title) {

    toast(
      "Введите название контента"
    );

    $("contentTitle")
      .focus();

    return;
  }


  const nodes =
    [
      ...document
        .querySelectorAll(
          "[data-publication]"
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
      node
        .querySelector(
          '[data-field="title"]'
        )
        .value
        .trim();


    const pubDate =
      node
        .querySelector(
          '[data-field="date"]'
        )
        .value;


    if (
      !pubTitle ||
      !pubDate
    ) {

      toast(
        "Заполните название и дату публикации"
      );

      return;
    }
  }


  saving =
    true;


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
        .value ||
      null;


    let savedContent;


    /* CONTENT */

    if (contentId) {

      const {
        data,
        error
      } =
        await db
          .from("content")
          .update({
            title,
            description:
              $("contentDescription")
                .value
                .trim()
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

    } else {

      const {
        data,
        error
      } =
        await db
          .from("content")
          .insert({
            project_id:
              currentProject.id,

            title,

            description:
              $("contentDescription")
                .value
                .trim(),

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


    const editorNodes =
      [
        ...document
          .querySelectorAll(
            "[data-publication]"
          )
      ];


    const keptIds =
      [];


    /* PUBLICATIONS */

    for (
      const node of editorNodes
    ) {

      const get =
        field =>
          node
            .querySelector(
              `[data-field="${field}"]`
            )
            .value;


      const payload = {

        content_id:
          savedContent.id,

        project_id:
          currentProject.id,

        title:
          get("title")
            .trim(),

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
          get("link")
            .trim() ||
          null,

        description:
          get("description")
            .trim() ||
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
            .from("publications")
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
            .from("publications")
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


      /* ASSIGNEES */

      const selected =
        [
          ...(
            node._selected ||
            new Set()
          )
        ];


      const {
        error:
          deleteAssigneeError
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


      if (
        deleteAssigneeError
      ) {
        throw deleteAssigneeError;
      }


      if (
        selected.length
      ) {

        const rows =
          selected.map(
            user_id => ({
              publication_id:
                pub.id,
              user_id
            })
          );


        const {
          error:
            assigneeError
        } =
          await db
            .from(
              "publication_assignees"
            )
            .insert(
              rows
            );


        if (
          assigneeError
        ) {
          throw assigneeError;
        }
      }
    }


    /* REMOVED PUBLICATIONS */

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

    saving =
      false;


    if (submit) {

      submit.disabled =
        false;

      submit.textContent =
        "Сохранить";
    }
  }
}


/* =========================
   DELETE
========================= */

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

    console.error(
      error
    );

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


/* =========================
   EVENTS
========================= */

function bindEvents() {


  /* MONTH */

  $("prevMonth")
    ?.addEventListener(
      "click",
      () => {

        currentMonth =
          new Date(
            currentMonth
              .getFullYear(),

            currentMonth
              .getMonth() - 1,

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
            currentMonth
              .getFullYear(),

            currentMonth
              .getMonth() + 1,

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


  /* ADD */

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
          $("addPublicationForDay")
            .dataset
            .date ||
          isoToday();


        closeDayDetails();

        openModal(
          null,
          date
        );
      }
    );


  /* FORM */

  $("contentForm")
    ?.addEventListener(
      "submit",
      event => {

        saveContent(
          event
        ).catch(
          error => {

            console.error(
              error
            );

            toast(
              error?.message ||
              "Ошибка сохранения"
            );
          }
        );
      }
    );


  $("deleteContentBtn")
    ?.addEventListener(
      "click",
      deleteContent
    );


  /* CLOSE */

  document
    .querySelectorAll(
      "[data-close-modal]"
    )
    .forEach(
      element =>
        element.addEventListener(
          "click",
          closeModal
        )
    );


  document
    .querySelectorAll(
      "[data-close-day]"
    )
    .forEach(
      element =>
        element.addEventListener(
          "click",
          closeDayDetails
        )
    );


  /* NAV */

  document
    .querySelectorAll(
      ".nav-item"
    )
    .forEach(
      button =>
        button.addEventListener(
          "click",
          () =>
            switchView(
              button.dataset.view
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


  /* FILTERS */

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
              button.dataset
                .period;


            document
              .querySelectorAll(
                ".filter-btn"
              )
              .forEach(
                other =>
                  other.classList.toggle(
                    "active",
                    other ===
                    button
                  )
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


  /* ESC */

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


/* =========================
   START
========================= */

boot();
