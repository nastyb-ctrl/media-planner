const SUPABASE_URL = "https://vkvrwayzqrlsfsgjjwpy.supabase.co";
const SUPABASE_KEY = "sb_publishable_-kj7hiC7uou3db2wpwFM_w_jgXQNpnb";

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

const tg = window.Telegram?.WebApp || null;

const $ = (id) => document.getElementById(id);

let currentUser = null;
let currentProfile = null;
let currentProject = null;

let members = [];
let contents = [];
let publications = [];
let assigneeRows = [];

let currentMonth = new Date();

let activePeriod = "week";

let selectedDayForNewPublication = null;

let saving = false;

let realtimeChannels = [];

let memberPoll = null;
let plannerPoll = null;


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


function esc(value) {

  return String(value ?? "")
    .replace(
      /[&<>"']/g,
      (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[c])
    );

}


function pad(n) {

  return String(n).padStart(2, "0");

}


function isoToday() {

  const d = new Date();

  return (
    `${d.getFullYear()}-` +
    `${pad(d.getMonth() + 1)}-` +
    `${pad(d.getDate())}`
  );

}


function toISO(d) {

  return (
    `${d.getFullYear()}-` +
    `${pad(d.getMonth() + 1)}-` +
    `${pad(d.getDate())}`
  );

}


function formatDate(date) {

  if (!date) return "";

  const [
    year,
    month,
    day
  ] = date
    .split("-")
    .map(Number);

  return (
    `${day} ` +
    `${shortMonths[month - 1]}`
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


function sortPublication(a, b) {

  const aa =
    `${a.publication_date}T` +
    `${a.publication_time || "23:59:59"}`;

  const bb =
    `${b.publication_date}T` +
    `${b.publication_time || "23:59:59"}`;

  return aa.localeCompare(bb);

}


function platformClass(platform) {

  return String(
    platform || "другое"
  )
    .toLowerCase()
    .replace(
      /[^a-zа-яё]/gi,
      ""
    ) || "другое";

}


function toast(text) {

  document
    .querySelector(".toast")
    ?.remove();

  const el =
    document.createElement("div");

  el.className = "toast";

  el.textContent = text;

  document.body.appendChild(el);

  setTimeout(
    () => el.remove(),
    2400
  );

}


function avatarHtml(
  profile,
  small = false
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
      <span
        class="avatar${small ? " small" : ""}"
      >
        <img
          src="${esc(
            profile.telegram_photo_url
          )}"
          alt=""
        >
      </span>
    `;

  }

  return `
    <span
      class="avatar${small ? " small" : ""}"
    >
      ${esc(initials)}
    </span>
  `;

}


function telegramInitData() {

  return tg?.initData || "";

}


/* =========================
   ЗАПУСК
========================= */

async function boot() {

  try {

    tg?.ready();

    tg?.expand();

    tg?.setHeaderColor?.(
      "#f7f7f5"
    );

    tg?.setBackgroundColor?.(
      "#f7f7f5"
    );


    let session =
      (
        await db.auth.getSession()
      ).data.session;


    /*
      Если открыли в браузере
      или Telegram Desktop —
      создаём техническую
      anonymous-сессию.
    */

    if (!session) {

      const {
        data,
        error
      } =
        await db.auth
          .signInAnonymously();

      if (error) {
        throw error;
      }

      session =
        data?.session ||
        (
          await db.auth.getSession()
        ).data.session;

    }


    if (!session?.user) {

      throw new Error(
        "Не удалось создать рабочую сессию."
      );

    }


    currentUser =
      session.user;


    /*
      Если приложение открыто
      внутри Telegram —
      авторизуем Telegram-пользователя.
    */

    const initData =
      telegramInitData();


    if (initData) {

      const {
        data,
        error
      } =
        await db.functions.invoke(
          "telegram-auth",
          {
            body: {
              initData
            }
          }
        );


      if (error) {
        throw error;
      }


      if (data?.error) {

        throw new Error(
          data.error
        );

      }


      /*
        После telegram-auth
        получаем свежую сессию.
      */

      const fresh =
        (
          await db.auth.getSession()
        ).data.session;


      if (fresh?.user) {

        currentUser =
          fresh.user;

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
   ПРОФИЛЬ
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
   ПРОЕКТ
========================= */

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


  currentProject =
    Array.isArray(data)
      ? data[0]
      : data;


  if (
    !currentProject?.id
  ) {

    throw new Error(
      "Не найден проект команды."
    );

  }

}


/* =========================
   ЗАГРУЗКА ДАННЫХ
========================= */

async function loadAll() {

  await Promise.all([
    loadMembers(),
    loadContent()
  ]);

  renderEverything();

}


/* =========================
   УЧАСТНИКИ
========================= */

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
      "MEMBERS ERROR:",
      error
    );

    members =
      currentProfile
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


  const count =
    $("teamCount");


  if (count) {

    const n =
      members.length;

    let word =
      "участников";

    if (n === 1) {
      word = "участник";
    } else if (
      n >= 2 &&
      n <= 4
    ) {
      word = "участника";
    }

    count.textContent =
      `${n} ${word}`;

  }

}


/* =========================
   КОНТЕНТ + ПУБЛИКАЦИИ
========================= */

async function loadContent() {

  if (!currentProject?.id) {
    return;
  }


  const {
    data: c,
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


  const {
    data: p,
    error: publicationsError
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


  if (publicationsError) {
    throw publicationsError;
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


/* =========================
   REALTIME
========================= */

function setupRealtime() {

  realtimeChannels
    .forEach(
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
  ]
    .forEach(
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
   АВТООБНОВЛЕНИЕ
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

          renderTeam();

        } catch (_) {}

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


/* =========================
   ПОКАЗ ПРИЛОЖЕНИЯ
========================= */

function showApp() {

  $("authScreen")
    ?.classList
    .add("hidden");


  /*
    ВАЖНО:
    здесь должен быть app,
    а не mainScreen.
  */

  $("app")
    ?.classList
    .remove("hidden");


  switchView(
    "calendarView"
  );

}


/* =========================
   ОШИБКА
========================= */

function showAuthError(
  message
) {

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


/* =========================
   ПЕРЕКЛЮЧЕНИЕ ЭКРАНОВ
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
          "hidden",
          view.id !== viewId
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
   РЕНДЕР
========================= */

function renderEverything() {

  renderCalendar();

  renderUpcoming();

  renderContent();

  renderTeam();

  renderAnalytics();

}


/* =========================
   КАЛЕНДАРЬ
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


  /*
    Новая версия использует
    monthLabel.
    Старую тоже поддерживаем.
  */

  const label =
    $("monthLabel") ||
    $("currentMonth");


  if (label) {

    label.textContent =
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
    (
      first.getDay() +
      6
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
    let i = 0;
    i < total;
    i++
  ) {

    const day =
      i -
      leading +
      1;


    const dateObj =
      new Date(
        year,
        month,
        day
      );


    const date =
      toISO(
        dateObj
      );


    const cell =
      document.createElement(
        "div"
      );


    cell.className =
      "calendar-cell";


    if (
      dateObj.getMonth() !==
      month
    ) {

      cell.classList.add(
        "muted"
      );

    }


    const isToday =
      date ===
      isoToday();


    cell.innerHTML = `
      <div
        class="day-number${
          isToday
            ? " today"
            : ""
        }"
      >
        ${dateObj.getDate()}
      </div>

      <div
        class="calendar-publications"
      ></div>
    `;


    cell.addEventListener(
      "click",
      () =>
        openDayDetails(
          date
        )
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


    const box =
      cell.querySelector(
        ".calendar-publications"
      );


    list
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
            `pub-chip ${platformClass(
              publication.platform
            )}${
              publication.status ===
              "done"
                ? " done"
                : ""
            }`;


          chip.innerHTML =
            `${
              publication.publication_time
                ? `
                  <span class="pub-time">
                    ${esc(
                      publication
                        .publication_time
                        .slice(
                          0,
                          5
                        )
                    )}
                  </span>
                `
                : ""
            }${esc(
              publication.title
            )}`;


          chip.addEventListener(
            "click",
            event => {

              event.stopPropagation();

              openModal(
                publication.content_id
              );

            }
          );


          box.appendChild(
            chip
          );

        }
      );


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


      box.appendChild(
        more
      );

    }


    grid.appendChild(
      cell
    );

  }

}


/* =========================
   ДЕНЬ
========================= */

function openDayDetails(
  date
) {

  selectedDayForNewPublication =
    date;


  const modal =
    $("dayModal");


  const listBox =
    $("dayPublicationList");


  if (
    !modal ||
    !listBox
  ) {

    return;

  }


  const d =
    new Date(
      `${date}T12:00:00`
    );


  const eyebrow =
    $("dayModalEyebrow");


  if (eyebrow) {

    eyebrow.textContent =
      `${d.getDate()} ${
        shortMonths[
          d.getMonth()
        ]
      } ${
        d.getFullYear()
      }`;

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


  listBox.innerHTML =
    list.length
      ? list
          .map(
            p => `
              <button
                type="button"
                class="day-publication"
                data-day-pub="${
                  p.id
                }"
              >

                <div class="day-pub-time">
                  ${
                    p.publication_time
                      ? esc(
                          p.publication_time
                            .slice(
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
                      p.title
                    )}
                  </div>

                  <div class="day-pub-meta">
                    ${esc(
                      p.platform
                    )}
                    ·
                    ${esc(
                      p.format
                    )}
                    ·
                    ${statusLabel(
                      p.status
                    )}
                  </div>

                </div>

                <span class="chevron">
                  ›
                </span>

              </button>
            `
          )
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
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () => {

            const p =
              publications.find(
                x =>
                  x.id ===
                  button.dataset.dayPub
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


/* =========================
   БЛИЖАЙШИЕ
========================= */

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
        p => {

          const dt =
            new Date(
              `${
                p.publication_date
              }T${
                p.publication_time ||
                "23:59:59"
              }`
            );


          return dt >= now;

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
        p => `
          <button
            type="button"
            class="upcoming-card"
            data-upcoming="${p.id}"
          >

            <div class="date-box">

              <strong>
                ${p.publication_date.slice(
                  8,
                  10
                )}
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


            <div class="upcoming-main">

              <div class="upcoming-title">
                ${esc(
                  p.title
                )}
              </div>

              <div class="upcoming-meta">
                ${esc(
                  p.platform
                )}
                ·
                ${esc(
                  p.format
                )}
                ${
                  p.publication_time
                    ? ` · ${esc(
                        p.publication_time.slice(
                          0,
                          5
                        )
                      )}`
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
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () => {

            const p =
              publications.find(
                x =>
                  x.id ===
                  button.dataset.upcoming
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
   КОНТЕНТ
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
        ?.value || ""
    )
      .trim()
      .toLowerCase();


  const platform =
    $(
      "contentPlatformFilter"
    )?.value ||
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
          (
            !search ||
            text.includes(
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
              data-content="${
                content.id
              }"
            >

              <div
                class="content-card-head"
              >

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
                          data-publication-id="${
                            p.id
                          }"
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
                              ${esc(
                                p.title
                              )}
                            </div>

                            <div class="content-pub-meta">
                              ${formatDate(
                                p.publication_date
                              )}
                              ${
                                p.publication_time
                                  ? ` · ${esc(
                                      p.publication_time.slice(
                                        0,
                                        5
                                      )
                                    )}`
                                  : ""
                              }
                              ·
                              ${esc(
                                p.format
                              )}
                            </div>

                          </div>


                          <span
                            class="status-pill ${
                              p.status
                            }"
                          >
                            ${statusLabel(
                              p.status
                            )}
                          </span>


                          <div class="assignee-mini">

                            ${publicationAssignees(
                              p.id
                            )
                              .slice(
                                0,
                                3
                              )
                              .map(
                                m =>
                                  avatarHtml(
                                    m,
                                    true
                                  )
                              )
                              .join("")}

                          </div>


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
                  button.dataset.publicationId
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
   КОМАНДА
========================= */

function renderTeam() {

  const box =
    $("teamList");


  if (!box) {
    return;
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
        member => `
          <div class="team-card">

            <div class="team-card-top">

              ${avatarHtml(
                member
              )}

              <div>

                <div class="team-name">
                  ${esc(
                    member.telegram_first_name ||
                    "Без имени"
                  )}
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

          </div>
        `
      )
      .join("");

}


/* =========================
   АНАЛИТИКА
========================= */

function analyticsList() {

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
    $(
      "analyticsPlatform"
    )?.value ||
    "all";


  return publications.filter(
    publication => {

      const d =
        new Date(
          `${publication.publication_date}T12:00:00`
        );


      return (
        (!from || d >= from) &&
        (
          platform ===
            "all" ||
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
  box,
  object
) {

  if (!box) {
    return;
  }


  const entries =
    Object.entries(
      object
    )
      .sort(
        (a,b) =>
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


  box.innerHTML = `
    <div class="bars">

      ${
        entries
          .map(
            ([name, value]) => `
              <div class="bar-row">

                <span>
                  ${esc(name)}
                </span>

                <div class="bar-track">

                  <div
                    class="bar-fill"
                    style="width:${Math.max(
                      5,
                      value / max * 100
                    )}%"
                  ></div>

                </div>

                <b>
                  ${value}
                </b>

              </div>
            `
          )
          .join("")
      }

    </div>
  `;

}


function renderAnalytics() {

  const list =
    analyticsList();


  const total =
    $("statTotal");


  const week =
    $("statWeek");


  if (total) {

    total.textContent =
      list.length;

  }


  if (week) {

    let days = 1;


    if (
      activePeriod ===
      "week"
    ) {

      days = 7;

    } else if (
      activePeriod ===
      "month"
    ) {

      days = 30;

    } else if (
      activePeriod ===
      "3months"
    ) {

      days = 90;

    } else if (
      list.length
    ) {

      days =
        Math.max(
          1,
          Math.round(
            (
              new Date(
                maxDate(list)
              ) -
              new Date(
                minDate(list)
              )
            ) /
            86400000
          ) + 1
        );

    }


    week.textContent =
      (
        list.length /
        days *
        7
      ).toFixed(1);

  }


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

      const d =
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
        ][
          d.getDay()
        ];


      weekdays[name] =
        (
          weekdays[name] ||
          0
        ) + 1;

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
      )
        .forEach(
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
    $("assigneeStats"),
    assignees
  );

}


function minDate(list) {

  return list.reduce(
    (
      result,
      item
    ) =>
      result <
      item.publication_date
        ? result
        : item.publication_date,
    list[0]
      .publication_date
  );

}


function maxDate(list) {

  return list.reduce(
    (
      result,
      item
    ) =>
      result >
      item.publication_date
        ? result
        : item.publication_date,
    list[0]
      .publication_date
  );

}


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


/* =========================
   РЕДАКТОР КОНТЕНТА
========================= */

function openModal(
  contentId = null,
  presetDate = null
) {

  const modal =
    $("modal");


  if (!modal) {
    return;
  }


  modal.classList.remove(
    "hidden"
  );


  /*
    ВАЖНО:
    здесь editingContentId,
    а не contentId.
  */

  const editingId =
    $("editingContentId");


  if (editingId) {

    editingId.value =
      contentId || "";

  }


  $("modalTitle")
    .textContent =
      contentId
        ? "Редактировать контент"
        : "Новый контент";


  $("deleteContentBtn")
    ?.classList
    .toggle(
      "hidden",
      !contentId
    );


  $("contentTitle")
    .value = "";


  $("contentDescription")
    .value = "";


  const editorList =
    $("publicationEditorList");


  if (!editorList) {
    return;
  }


  editorList.innerHTML =
    "";


  if (contentId) {

    const content =
      contents.find(
        x =>
          x.id ===
          contentId
      );


    if (content) {

      $("contentTitle")
        .value =
          content.title ||
          "";


      $("contentDescription")
        .value =
          content.description ||
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

  $("modal")
    ?.classList
    .add("hidden");

}


/* =========================
   РЕДАКТОР ПУБЛИКАЦИИ
========================= */

function addPublicationEditor(
  data = null,
  presetDate = null
) {

  const template =
    $("publicationTemplate");


  const wrap =
    $("publicationEditorList");


  if (
    !template ||
    !wrap
  ) {

    return;

  }


  const node =
    template.content
      .cloneNode(true)
      .firstElementChild;


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


  const field =
    name =>
      node.querySelector(
        `[data-field="${name}"]`
      );


  field("title")
    .value =
      data?.title ||
      "";


  field("platform")
    .value =
      data?.platform ||
      "Telegram";


  field("format")
    .value =
      data?.format ||
      "Пост";


  field("date")
    .value =
      data?.publication_date ||
      presetDate ||
      isoToday();


  field("time")
    .value =
      data?.publication_time
        ? data.publication_time
            .slice(0,5)
        : "";


  field("status")
    .value =
      data?.status ||
      "planned";


  field("link")
    .value =
      data?.link ||
      "";


  field("description")
    .value =
      data?.description ||
      "";


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


  const renderPicker =
    () => {

      const search =
        (
          node.querySelector(
            "[data-search]"
          ).value ||
          ""
        )
          .trim()
          .toLowerCase();


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
                      data-remove="${
                        member.id
                      }"
                    >
                      ×
                    </button>

                  </span>
                `
              )
              .join("")
          : `
              <span class="assignee-placeholder">
                Никто не выбран
              </span>
            `;


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
              name.includes(
                search
              ) ||
              username.includes(
                search
              )
            );

          }
        );


      optionsBox.innerHTML = `
        <div class="assignee-options">

          ${
            filtered
              .map(
                member => `
                  <label
                    class="assignee-option"
                  >

                    <input
                      type="checkbox"
                      data-user="${
                        member.id
                      }"
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
                          ? ` · @${esc(
                              member.telegram_username
                            )}`
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


  node
    .querySelector(
      "[data-search]"
    )
    .addEventListener(
      "input",
      renderPicker
    );


  node
    .querySelector(
      ".remove-publication"
    )
    .addEventListener(
      "click",
      () => {

        if (
          wrap.querySelectorAll(
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

      }
    );


  wrap.appendChild(
    node
  );


  renderPicker();

  renumberEditors();

}


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


/* =========================
   СОХРАНЕНИЕ
========================= */

async function saveContent(
  event
) {

  event.preventDefault();


  if (
    saving ||
    !currentProject?.id
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


  saving = true;


  const button =
    $("contentForm")
      ?.querySelector(
        'button[type="submit"]'
      );


  if (button) {

    button.disabled =
      true;

    button.textContent =
      "Сохраняем…";

  }


  try {

    const id =
      $("editingContentId")
        .value ||
      null;


    const payload = {

      title,

      description:
        $("contentDescription")
          .value
          .trim() ||
        null

    };


    let saved;


    if (id) {

      const result =
        await db
          .from("content")
          .update(
            payload
          )
          .eq(
            "id",
            id
          )
          .select()
          .single();


      if (result.error) {
        throw result.error;
      }


      saved =
        result.data;

    } else {

      const result =
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


      if (result.error) {
        throw result.error;
      }


      saved =
        result.data;

    }


    const kept = [];


    for (
      const node of nodes
    ) {

      const get =
        fieldName =>
          node
            .querySelector(
              `[data-field="${fieldName}"]`
            )
            .value;


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
        node.dataset
          .existingId;


      let result;


      if (existingId) {

        result =
          await db
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
            .single();

      } else {

        result =
          await db
            .from(
              "publications"
            )
            .insert(
              pubPayload
            )
            .select()
            .single();

      }


      if (result.error) {
        throw result.error;
      }


      const publication =
        result.data;


      kept.push(
        publication.id
      );


      const deleted =
        await db
          .from(
            "publication_assignees"
          )
          .delete()
          .eq(
            "publication_id",
            publication.id
          );


      if (deleted.error) {
        throw deleted.error;
      }


      const selected =
        [
          ...(node._selected ||
            new Set())
        ];


      if (
        selected.length
      ) {

        const inserted =
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


        if (inserted.error) {
          throw inserted.error;
        }

      }

    }


    if (id) {

      const removed =
        publications
          .filter(
            publication =>
              publication.content_id ===
                id &&
              !kept.includes(
                publication.id
              )
          )
          .map(
            publication =>
              publication.id
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


    if (button) {

      button.disabled =
        false;

      button.textContent =
        "Сохранить";

    }

  }

}


/* =========================
   УДАЛЕНИЕ
========================= */

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
   СОБЫТИЯ
========================= */

function bindEvents() {


  /*
    Месяц назад
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


  /*
    Месяц вперёд
  */

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


  /*
    Сегодня
  */

  $("todayBtn")
    ?.addEventListener(
      "click",
      () => {

        currentMonth =
          new Date();

        renderCalendar();

      }
    );


  /*
    Плюс сверху календаря
  */

  $("addPublicationTop")
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

  $("addContentInline")
    ?.addEventListener(
      "click",
      () =>
        openModal()
    );


  /*
    + Публикация
  */

  $("addPublication")
    ?.addEventListener(
      "click",
      () =>
        addPublicationEditor(
          null,
          selectedDayForNewPublication ||
          isoToday()
        )
    );


  /*
    Добавить публикацию
    из окна дня
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

  $("deleteContentBtn")
    ?.addEventListener(
      "click",
      deleteContent
    );


  /*
    Закрытие окон
  */

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
    Все публикации
  */

  $("showAllContent")
    ?.addEventListener(
      "click",
      () =>
        switchView(
          "contentView"
        )
    );


  /*
    Поиск
  */

  $("contentSearch")
    ?.addEventListener(
      "input",
      renderContent
    );


  /*
    Фильтр соцсети
  */

  $("contentPlatformFilter")
    ?.addEventListener(
      "change",
      renderContent
    );


  /*
    Аналитика — период
  */

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


  /*
    Аналитика — соцсеть
  */

  $("analyticsPlatform")
    ?.addEventListener(
      "change",
      renderAnalytics
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


/* =========================
   СТАРТ
========================= */

boot();
