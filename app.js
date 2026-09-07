const SUPABASE_URL = "https://vkvrwayzqrlsfsgjjwpy.supabase.co";
const SUPABASE_KEY = "sb_publishable_-kj7hiC7uou3db2wpwFM_w_jgXQNpnb";

let db = null;
let tg = null;

let currentUser = null;
let currentProfile = null;
let currentProject = null;

let members = [];
let contents = [];
let publications = [];
let assignees = [];

let currentMonth = new Date();
let selectedDay = null;
let saving = false;

/* =========================
   HELPERS
========================= */

const $ = id => document.getElementById(id);

const esc = value =>
  String(value ?? "").replace(
    /[&<>"']/g,
    char =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[char]
  );

const pad = n =>
  String(n).padStart(2, "0");

function todayISO() {
  const d = new Date();

  return `${d.getFullYear()}-${pad(
    d.getMonth() + 1
  )}-${pad(d.getDate())}`;
}

function dateISO(d) {
  return `${d.getFullYear()}-${pad(
    d.getMonth() + 1
  )}-${pad(d.getDate())}`;
}

const months = [
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

function formatDate(date) {
  if (!date) return "";

  const parts = date.split("-");

  return `${Number(parts[2])} ${
    shortMonths[Number(parts[1]) - 1]
  }`;
}

function platformClass(platform) {
  return String(platform || "")
    .toLowerCase()
    .replace(/[^a-zа-яё]/gi, "");
}

function statusText(status) {
  if (status === "done") return "Готово";
  if (status === "progress") return "В работе";

  return "Запланировано";
}

function toast(text) {
  document.querySelector(".toast")?.remove();

  const el = document.createElement("div");

  el.className = "toast";
  el.textContent = text;

  document.body.appendChild(el);

  setTimeout(() => {
    el.remove();
  }, 2500);
}

/* =========================
   START
========================= */

async function startApp() {
  try {
    if (!window.supabase) {
      throw new Error(
        "Supabase не загрузился. Проверь подключение supabase-js в index.html."
      );
    }

    db = window.supabase.createClient(
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

    tg =
      window.Telegram?.WebApp ||
      null;

    tg?.ready();
    tg?.expand();

    try {
      tg?.setHeaderColor?.("#f7f7f5");
      tg?.setBackgroundColor?.("#f7f7f5");
    } catch {}

    /* техническая анонимная сессия */
    let session =
      (
        await db.auth.getSession()
      ).data.session;

    if (!session) {
      const result =
        await db.auth.signInAnonymously();

      if (result.error) {
        throw result.error;
      }

      session =
        (
          await db.auth.getSession()
        ).data.session;
    }

    currentUser =
      session?.user || null;

    if (!currentUser) {
      throw new Error(
        "Не удалось создать сессию."
      );
    }

    /* Telegram авторизация */
    if (tg?.initData) {
      try {
        await db.functions.invoke(
          "telegram-auth",
          {
            body: {
              initData: tg.initData
            }
          }
        );
      } catch (error) {
        console.warn(
          "telegram-auth:",
          error
        );
      }
    }

    await loadProfile();
    await loadProject();
    await loadData();

    showApp();
    bindEvents();
    renderAll();

    startAutoRefresh();

  } catch (error) {
    console.error(
      "APP ERROR:",
      error
    );

    /* НИКОГДА не оставляем белый экран */
    showApp();

    const calendar =
      $("calendarGrid");

    if (calendar) {
      calendar.innerHTML = `
        <div class="empty">
          <strong>Планер открылся, но данные пока не загрузились.</strong>
          <br><br>
          ${esc(
            error?.message ||
              "Неизвестная ошибка"
          )}
          <br><br>
          Обнови приложение ещё раз.
        </div>
      `;
    }

    bindEvents();
  }
}

/* =========================
   AUTH / PROJECT
========================= */

async function loadProfile() {
  const result =
    await db
      .from("profiles")
      .select("*")
      .eq("id", currentUser.id)
      .maybeSingle();

  if (result.error) {
    console.warn(
      "Profile:",
      result.error
    );

    currentProfile = {
      id: currentUser.id,
      telegram_first_name:
        "Участник"
    };

    return;
  }

  currentProfile =
    result.data || {
      id: currentUser.id,
      telegram_first_name:
        "Участник"
    };
}

async function loadProject() {
  const result =
    await db.rpc(
      "get_default_project_for_user"
    );

  if (result.error) {
    throw result.error;
  }

  currentProject =
    Array.isArray(result.data)
      ? result.data[0]
      : result.data;

  if (!currentProject) {
    throw new Error(
      "Проект команды не найден."
    );
  }
}

/* =========================
   DATA
========================= */

async function loadData() {
  await Promise.all([
    loadMembers(),
    loadContents(),
    loadPublications()
  ]);

  await loadAssignees();
}

async function loadMembers() {
  const result =
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

  if (result.error) {
    members = [];
    return;
  }

  members =
    result.data || [];
}

async function loadContents() {
  const result =
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

  if (result.error) {
    throw result.error;
  }

  contents =
    result.data || [];
}

async function loadPublications() {
  const result =
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
          ascending: true
        }
      );

  if (result.error) {
    throw result.error;
  }

  publications =
    result.data || [];
}

async function loadAssignees() {
  if (!publications.length) {
    assignees = [];
    return;
  }

  const ids =
    publications.map(
      p => p.id
    );

  const result =
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

  if (result.error) {
    assignees = [];
    return;
  }

  assignees =
    result.data || [];
}

/* =========================
   UI
========================= */

function showApp() {
  $("authScreen")?.classList.add(
    "hidden"
  );

  $("app")?.classList.remove(
    "hidden"
  );
}

function switchView(id) {
  document
    .querySelectorAll(".view")
    .forEach(view => {
      view.classList.toggle(
        "hidden",
        view.id !== id
      );
    });

  document
    .querySelectorAll(".nav-item")
    .forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.view === id
      );
    });
}

function renderAll() {
  renderCalendar();
  renderUpcoming();
  renderContent();
  renderTeam();
  renderAnalytics();
}

/* =========================
   CALENDAR
========================= */

function renderCalendar() {
  const grid =
    $("calendarGrid");

  if (!grid) return;

  const year =
    currentMonth.getFullYear();

  const month =
    currentMonth.getMonth();

  const label =
    $("monthLabel");

  if (label) {
    label.textContent =
      `${months[month]} ${year}`;
  }

  const first =
    new Date(
      year,
      month,
      1
    );

  const days =
    new Date(
      year,
      month + 1,
      0
    ).getDate();

  const offset =
    (first.getDay() + 6) %
    7;

  const total =
    Math.ceil(
      (offset + days) / 7
    ) * 7;

  grid.innerHTML = "";

  for (
    let i = 0;
    i < total;
    i++
  ) {
    const day =
      i - offset + 1;

    const d =
      new Date(
        year,
        month,
        day
      );

    const iso =
      dateISO(d);

    const cell =
      document.createElement(
        "div"
      );

    cell.className =
      "calendar-cell";

    if (
      d.getMonth() !== month
    ) {
      cell.classList.add(
        "muted"
      );
    }

    cell.innerHTML = `
      <div class="day-number ${
        iso === todayISO()
          ? "today"
          : ""
      }">
        ${d.getDate()}
      </div>
    `;

    const pubs =
      publications
        .filter(
          p =>
            p.publication_date ===
            iso
        )
        .sort(
          (a, b) =>
            (
              a.publication_time ||
              ""
            ).localeCompare(
              b.publication_time ||
                ""
            )
        );

    pubs
      .slice(0, 3)
      .forEach(pub => {
        const button =
          document.createElement(
            "button"
          );

        button.type =
          "button";

        button.className =
          `pub-chip ${platformClass(
            pub.platform
          )}`;

        button.innerHTML = `
          ${
            pub.publication_time
              ? `<span class="pub-time">
                  ${esc(
                    pub.publication_time.slice(
                      0,
                      5
                    )
                  )}
                </span>`
              : ""
          }
          ${esc(pub.title)}
        `;

        button.onclick =
          event => {
            event.stopPropagation();
            openContentModal(
              pub.content_id
            );
          };

        cell.appendChild(
          button
        );
      });

    if (pubs.length > 3) {
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
          pubs.length - 3
        }`;

      more.onclick =
        event => {
          event.stopPropagation();
          openDayModal(iso);
        };

      cell.appendChild(
        more
      );
    }

    cell.onclick = () =>
      openDayModal(iso);

    grid.appendChild(
      cell
    );
  }
}

/* =========================
   UPCOMING
========================= */

function renderUpcoming() {
  const box =
    $("upcomingList");

  if (!box) return;

  const list =
    [...publications]
      .sort(
        (a, b) =>
          `${a.publication_date}T${
            a.publication_time ||
            "23:59"
          }`.localeCompare(
            `${b.publication_date}T${
              b.publication_time ||
              "23:59"
            }`
          )
      )
      .filter(
        p =>
          p.publication_date >=
          todayISO()
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
          class="upcoming-card"
          type="button"
          data-upcoming="${p.id}"
        >
          <div class="date-box">
            <strong>
              ${Number(
                p.publication_date.slice(
                  8
                )
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
            class="platform-dot ${platformClass(
              p.platform
            )}"
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
      button.onclick =
        () => {
          const p =
            publications.find(
              x =>
                x.id ===
                button.dataset
                  .upcoming
            );

          if (p) {
            openContentModal(
              p.content_id
            );
          }
        };
    });
}

/* =========================
   CONTENT
========================= */

function renderContent() {
  const box =
    $("contentList");

  if (!box) return;

  const search =
    (
      $("contentSearch")
        ?.value || ""
    )
      .toLowerCase()
      .trim();

  const platform =
    $("contentPlatformFilter")
      ?.value || "all";

  const list =
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
            ...pubs.map(
              p =>
                `${p.title} ${p.platform} ${p.format}`
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

  if (!list.length) {
    box.innerHTML = `
      <div class="empty">
        ${
          contents.length
            ? "Ничего не найдено."
            : "Контента пока нет. Нажми «+ Контент»."
        }
      </div>
    `;

    return;
  }

  box.innerHTML =
    list
      .map(content => {
        const pubs =
          publications
            .filter(
              p =>
                p.content_id ===
                content.id
            )
            .sort(
              (a, b) =>
                a.publication_date.localeCompare(
                  b.publication_date
                )
            );

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
                  ${pubs.length}
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
              ${pubs
                .map(
                  p => `
                    <button
                      type="button"
                      class="content-publication"
                      data-publication-id="${p.id}"
                    >
                      <span
                        class="platform-dot ${platformClass(
                          p.platform
                        )}"
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
                        ${statusText(
                          p.status
                        )}
                      </span>

                      <span class="chevron">
                        ›
                      </span>
                    </button>
                  `
                )
                .join("")}
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
      card.onclick =
        event => {
          if (
            !event.target.closest(
              "[data-publication-id]"
            )
          ) {
            openContentModal(
              card.dataset
                .content
            );
          }
        };
    });

  box
    .querySelectorAll(
      "[data-publication-id]"
    )
    .forEach(button => {
      button.onclick =
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
            openContentModal(
              p.content_id
            );
          }
        };
    });
}

/* =========================
   TEAM
========================= */

function renderTeam() {
  const box =
    $("teamList");

  if (!box) return;

  const count =
    $("teamCount");

  if (count) {
    count.textContent =
      `${members.length} ${
        members.length === 1
          ? "участник"
          : "участников"
      }`;
  }

  if (!members.length) {
    box.innerHTML = `
      <div class="empty">
        Пока нет участников команды.
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
                  ${esc(
                    name
                      .slice(
                        0,
                        2
                      )
                      .toUpperCase()
                  )}
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
        }
      )
      .join("");
}

/* =========================
   ANALYTICS
========================= */

function renderAnalytics() {
  const list =
    publications;

  const total =
    $("statTotal");

  if (total) {
    total.textContent =
      list.length;
  }

  const week =
    $("statWeek");

  if (week) {
    week.textContent =
      (
        list.length / 4
      ).toFixed(1);
  }

  renderStats(
    $("platformStats"),
    list,
    "platform"
  );

  renderStats(
    $("formatStats"),
    list,
    "format"
  );

  const weekdays = {};

  list.forEach(p => {
    const d =
      new Date(
        `${p.publication_date}T12:00:00`
      );

    const names = [
      "Вс",
      "Пн",
      "Вт",
      "Ср",
      "Чт",
      "Пт",
      "Сб"
    ];

    const key =
      names[d.getDay()];

    weekdays[key] =
      (weekdays[key] || 0) + 1;
  });

  renderObjectStats(
    $("weekdayStats"),
    weekdays
  );

  const people = {};

  assignees.forEach(row => {
    const member =
      members.find(
        m =>
          m.id ===
          row.user_id
      );

    if (!member) return;

    const name =
      member.telegram_first_name ||
      member.telegram_username ||
      "Участник";

    people[name] =
      (people[name] || 0) + 1;
  });

  renderObjectStats(
    $("assigneeStats"),
    people
  );
}

function renderStats(
  box,
  list,
  key
) {
  if (!box) return;

  const result = {};

  list.forEach(item => {
    const value =
      item[key] ||
      "Не указано";

    result[value] =
      (result[value] || 0) + 1;
  });

  renderObjectStats(
    box,
    result
  );
}

function renderObjectStats(
  box,
  data
) {
  if (!box) return;

  const entries =
    Object.entries(data)
      .sort(
        (a, b) =>
          b[1] - a[1]
      );

  if (!entries.length) {
    box.innerHTML =
      `<div class="empty">Нет данных</div>`;

    return;
  }

  const max =
    entries[0][1];

  box.innerHTML = `
    <div class="bars">
      ${entries
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
                    (value / max) *
                      100
                  )}%"
                ></div>
              </div>

              <strong>
                ${value}
              </strong>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

/* =========================
   DAY MODAL
========================= */

function openDayModal(date) {
  selectedDay = date;

  const modal =
    $("dayModal");

  if (!modal) return;

  const title =
    $("dayModalTitle");

  if (title) {
    const count =
      publications.filter(
        p =>
          p.publication_date ===
          date
      ).length;

    title.textContent =
      `${count} ${
        count === 1
          ? "публикация"
          : "публикаций"
      }`;
  }

  const dateText =
    $("dayModalDate");

  if (dateText) {
    dateText.textContent =
      formatDate(date);
  }

  const list =
    $("dayPublicationList");

  if (list) {
    const pubs =
      publications.filter(
        p =>
          p.publication_date ===
          date
      );

    list.innerHTML =
      pubs.length
        ? pubs
            .map(
              p => `
                <button
                  type="button"
                  class="day-publication"
                  data-day-pub="${p.id}"
                >
                  <div class="day-pub-time">
                    ${
                      p.publication_time
                        ? esc(
                            p.publication_time.slice(
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
            Публикаций на этот день нет.
          </div>
        `;

    list
      .querySelectorAll(
        "[data-day-pub]"
      )
      .forEach(button => {
        button.onclick =
          () => {
            const p =
              publications.find(
                x =>
                  x.id ===
                  button.dataset
                    .dayPub
              );

            closeDayModal();

            if (p) {
              openContentModal(
                p.content_id
              );
            }
          };
      });
  }

  modal.classList.remove(
    "hidden"
  );
}

function closeDayModal() {
  $("dayModal")?.classList.add(
    "hidden"
  );
}

/* =========================
   CONTENT MODAL
========================= */

function openContentModal(
  contentId = null,
  date = null
) {
  const modal =
    $("modal");

  if (!modal) return;

  modal.classList.remove(
    "hidden"
  );

  const idInput =
    $("editingContentId");

  if (idInput) {
    idInput.value =
      contentId || "";
  }

  const title =
    $("modalTitle");

  if (title) {
    title.textContent =
      contentId
        ? "Редактировать контент"
        : "Новый контент";
  }

  const content =
    contentId
      ? contents.find(
          c =>
            c.id ===
            contentId
        )
      : null;

  if ($("contentTitle")) {
    $("contentTitle").value =
      content?.title || "";
  }

  if ($("contentDescription")) {
    $("contentDescription").value =
      content?.description ||
      "";
  }

  const list =
    $("publicationEditorList");

  if (!list) return;

  list.innerHTML = "";

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
              a.publication_date.localeCompare(
                b.publication_date
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
    addPublicationEditor(
      null,
      date || selectedDay || todayISO()
    );
  }

  const deleteButton =
    $("deleteContentBtn");

  if (deleteButton) {
    deleteButton.classList.toggle(
      "hidden",
      !contentId
    );
  }
}

function closeContentModal() {
  $("modal")?.classList.add(
    "hidden"
  );
}

/* =========================
   PUBLICATION EDITOR
========================= */

function addPublicationEditor(
  data = null,
  date = todayISO()
) {
  const list =
    $("publicationEditorList");

  if (!list) return;

  const editor =
    document.createElement(
      "div"
    );

  editor.className =
    "publication-editor";

  editor.dataset.publication =
    "true";

  editor.dataset.existingId =
    data?.id || "";

  editor.innerHTML = `
    <div class="publication-editor-head">
      <strong>
        Публикация
      </strong>

      <button
        type="button"
        class="remove-publication"
      >
        Удалить
      </button>
    </div>

    <div class="form-grid">

      <label class="field full">
        <span>Название</span>

        <input
          data-field="title"
          required
          value="${esc(
            data?.title || ""
          )}"
          placeholder="Название публикации"
        >
      </label>

      <label class="field">
        <span>Платформа</span>

        <select data-field="platform">

          <option
            ${
              data?.platform ===
              "Telegram"
                ? "selected"
                : ""
            }
          >
            Telegram
          </option>

          <option
            ${
              data?.platform ===
              "Instagram"
                ? "selected"
                : ""
            }
          >
            Instagram
          </option>

          <option
            ${
              data?.platform ===
              "VK"
                ? "selected"
                : ""
            }
          >
            VK
          </option>

          <option
            ${
              data?.platform ===
              "TikTok"
                ? "selected"
                : ""
            }
          >
            TikTok
          </option>

          <option
            ${
              data?.platform ===
              "YouTube"
                ? "selected"
                : ""
            }
          >
            YouTube
          </option>

        </select>
      </label>

      <label class="field">
        <span>Формат</span>

        <input
          data-field="format"
          value="${esc(
            data?.format ||
              "Пост"
          )}"
          placeholder="Пост / видео / рилс"
        >
      </label>

      <label class="field">
        <span>Дата</span>

        <input
          data-field="date"
          type="date"
          required
          value="${esc(
            data?.publication_date ||
              date
          )}"
        >
      </label>

      <label class="field">
        <span>Время</span>

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
        <span>Статус</span>

        <select data-field="status">

          <option
            value="planned"
            ${
              !data ||
              data.status ===
                "planned"
                ? "selected"
                : ""
            }
          >
            Запланировано
          </option>

          <option
            value="progress"
            ${
              data?.status ===
              "progress"
                ? "selected"
                : ""
            }
          >
            В работе
          </option>

          <option
            value="done"
            ${
              data?.status ===
              "done"
                ? "selected"
                : ""
            }
          >
            Готово
          </option>

        </select>
      </label>

      <label class="field full">
        <span>Ссылка</span>

        <input
          data-field="link"
          value="${esc(
            data?.link || ""
          )}"
          placeholder="https://..."
        >
      </label>

      <label class="field full">
        <span>Комментарий</span>

        <textarea
          data-field="description"
          rows="2"
          placeholder="Комментарий"
        >${esc(
          data?.description ||
            ""
        )}</textarea>
      </label>

    </div>

    <div class="reminders">

      <label>
        <input
          type="checkbox"
          data-reminder="24"
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
          type="checkbox"
          data-reminder="3"
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
          type="checkbox"
          data-reminder="1"
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

  editor
    .querySelector(
      ".remove-publication"
    )
    .onclick =
    () => {
      editor.remove();
    };

  list.appendChild(
    editor
  );
}

/* =========================
   SAVE
========================= */

async function saveContent(
  event
) {
  event?.preventDefault();

  if (saving) return;

  const title =
    $("contentTitle")
      ?.value.trim();

  if (!title) {
    toast(
      "Введите название контента"
    );

    return;
  }

  const editors =
    [
      ...document.querySelectorAll(
        "#publicationEditorList [data-publication]"
      )
    ];

  if (!editors.length) {
    toast(
      "Добавьте публикацию"
    );

    return;
  }

  saving = true;

  const saveButton =
    $("saveContentBtn");

  if (saveButton) {
    saveButton.disabled =
      true;

    saveButton.textContent =
      "Сохраняем…";
  }

  try {
    const editingId =
      $("editingContentId")
        ?.value || null;

    let contentId =
      editingId;

    if (editingId) {
      const result =
        await db
          .from("content")
          .update({
            title,
            description:
              $("contentDescription")
                ?.value
                .trim() || null
          })
          .eq(
            "id",
            editingId
          );

      if (result.error) {
        throw result.error;
      }
    } else {
      const result =
        await db
          .from("content")
          .insert({
            project_id:
              currentProject.id,
            title,
            description:
              $("contentDescription")
                ?.value
                .trim() || null,
            created_by:
              currentUser.id
          })
          .select()
          .single();

      if (result.error) {
        throw result.error;
      }

      contentId =
        result.data.id;
    }

    const savedIds = [];

    for (
      const editor of editors
    ) {
      const get =
        field =>
          editor.querySelector(
            `[data-field="${field}"]`
          )?.value || "";

      const payload = {
        content_id:
          contentId,

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
          editor.querySelector(
            '[data-reminder="24"]'
          )?.checked ||
          false,

        reminder_3h:
          editor.querySelector(
            '[data-reminder="3"]'
          )?.checked ||
          false,

        reminder_1h:
          editor.querySelector(
            '[data-reminder="1"]'
          )?.checked ||
          false
      };

      const existingId =
        editor.dataset
          .existingId;

      let result;

      if (existingId) {
        result =
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
            .single();
      } else {
        result =
          await db
            .from(
              "publications"
            )
            .insert(
              payload
            )
            .select()
            .single();
      }

      if (result.error) {
        throw result.error;
      }

      const publication =
        result.data;

      savedIds.push(
        publication.id
      );
    }

    /* удалить старые публикации,
       которые убрали из редактора */

    if (editingId) {
      const old =
        publications.filter(
          p =>
            p.content_id ===
              editingId &&
            !savedIds.includes(
              p.id
            )
        );

      if (old.length) {
        const result =
          await db
            .from(
              "publications"
            )
            .delete()
            .in(
              "id",
              old.map(
                p => p.id
              )
            );

        if (result.error) {
          throw result.error;
        }
      }
    }

    closeContentModal();

    await loadData();

    renderAll();

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
    saving = false;

    if (saveButton) {
      saveButton.disabled =
        false;

      saveButton.textContent =
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
      ?.value;

  if (!id) return;

  if (
    !confirm(
      "Удалить этот контент?"
    )
  ) {
    return;
  }

  const result =
    await db
      .from("content")
      .delete()
      .eq(
        "id",
        id
      );

  if (result.error) {
    toast(
      result.error.message
    );

    return;
  }

  closeContentModal();

  await loadData();

  renderAll();

  toast(
    "Удалено"
  );
}

/* =========================
   EVENTS
========================= */

function bindEvents() {
  $("prevMonth")?.addEventListener(
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

  $("nextMonth")?.addEventListener(
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

  $("todayBtn")?.addEventListener(
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
        openContentModal(
          null,
          todayISO()
        )
    );

  $("addContentInline")
    ?.addEventListener(
      "click",
      () =>
        openContentModal()
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
        closeDayModal();

        openContentModal(
          null,
          selectedDay ||
            todayISO()
        );
      }
    );

  $("contentForm")
    ?.addEventListener(
      "submit",
      saveContent
    );

  $("saveContentBtn")
    ?.addEventListener(
      "click",
      saveContent
    );

  $("deleteContentBtn")
    ?.addEventListener(
      "click",
      deleteContent
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
      ".nav-item"
    )
    .forEach(button => {
      button.addEventListener(
        "click",
        () =>
          switchView(
            button.dataset
              .view
          )
      );
    });

  document
    .querySelectorAll(
      "[data-close-modal]"
    )
    .forEach(button => {
      button.addEventListener(
        "click",
        closeContentModal
      );
    });

  document
    .querySelectorAll(
      "[data-close-day]"
    )
    .forEach(button => {
      button.addEventListener(
        "click",
        closeDayModal
      );
    });

  document
    .querySelectorAll(
      ".modal-close"
    )
    .forEach(button => {
      button.addEventListener(
        "click",
        closeContentModal
      );
    });

  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key ===
        "Escape"
      ) {
        closeContentModal();
        closeDayModal();
      }
    }
  );
}

/* =========================
   AUTO UPDATE
========================= */

function startAutoRefresh() {
  setInterval(
    async () => {
      try {
        await loadData();
        renderAll();
      } catch (error) {
        console.warn(
          "Auto refresh:",
          error
        );
      }
    },
    15000
  );
}

/* =========================
   RUN
========================= */

startApp();
