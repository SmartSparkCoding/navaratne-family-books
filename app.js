import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getDatabase,
  onValue,
  push,
  ref,
  remove,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

const appConfig = window.APP_CONFIG ?? {};
const firebaseConfig = appConfig.firebase ?? {};
const expectedPasscode = String(appConfig.passcode ?? "0000");

const readerNames = ["Sarah", "Leroy", "Jacob", "Ollie", "Grannie"];
const defaultBookcases = [];

const state = {
  unlocked: false,
  passcodeBuffer: "",
  view: "dashboard",
  search: "",
  bookcaseFilter: "all",
  readerFilter: "all",
  books: [],
  bookcases: [],
  firebaseReady: false,
  modalBookId: null,
  addMode: null,
  addMenuOpen: false,
  selectedReader: readerNames[0],
  addRenderedMode: null,
};

const elements = {
  loginOverlay: document.getElementById("loginOverlay"),
  loginStatus: document.getElementById("loginStatus"),
  keypad: document.getElementById("keypad"),
  dots: [0, 1, 2, 3].map((index) => document.getElementById(`dot${index}`)),
  navButtons: [...document.querySelectorAll(".nav-btn")],
  searchInput: document.getElementById("searchInput"),
  openAddBookTop: document.getElementById("openAddBookTop"),
  quickAddMenu: document.getElementById("quickAddMenu"),
  quickAddOptions: document.getElementById("quickAddOptions"),
  addOptionsGrid: document.getElementById("addOptionsGrid"),
  addWorkspace: document.getElementById("addWorkspace"),
  bookcaseLibraryGrid: document.getElementById("bookcaseLibraryGrid"),
  dashboardView: document.getElementById("dashboardView"),
  booksView: document.getElementById("booksView"),
  addView: document.getElementById("addView"),
  statsView: document.getElementById("statsView"),
  summaryCards: document.getElementById("summaryCards"),
  booksGrid: document.getElementById("booksGrid"),
  booksCountLabel: document.getElementById("booksCountLabel"),
  bookcaseFilter: document.getElementById("bookcaseFilter"),
  readerFilter: document.getElementById("readerFilter"),
  clearFilters: document.getElementById("clearFilters"),
  readerStatsGrid: document.getElementById("readerStatsGrid"),
  readerDetailPanel: document.getElementById("readerDetailPanel"),
  bookModal: document.getElementById("bookModal"),
  bookDetailSummary: document.getElementById("bookDetailSummary"),
  editFormMount: document.getElementById("editFormMount"),
  addFormMount: document.getElementById("addFormMount"),
  toastStack: document.getElementById("toastStack"),
  bookFormTemplate: document.getElementById("bookFormTemplate"),
  bookcaseFormTemplate: document.getElementById("bookcaseFormTemplate"),
};

const palette = ["#f2bac3", "#f6d39a", "#79b6af", "#c7c0f0", "#f0b79b", "#a8d8c7", "#e7d2f5", "#b6d7f5"];

let database = null;
let booksRef = null;
let bookcasesRef = null;
let editForm = null;
let bookcaseForm = null;

function initFirebase() {
  try {
    if (!firebaseConfig.apiKey || !firebaseConfig.databaseURL || !firebaseConfig.projectId) {
      throw new Error("Missing Firebase configuration.");
    }

    const app = initializeApp(firebaseConfig);
    database = getDatabase(app);
    booksRef = ref(database, "books");
    bookcasesRef = ref(database, "bookcases");
    state.firebaseReady = true;

    onValue(booksRef, (snapshot) => {
      state.books = snapshotToArray(snapshot.val());
      refreshAll();
    });

    onValue(bookcasesRef, (snapshot) => {
      const loaded = snapshotToArray(snapshot.val()).map((bookcase) => ({
        ...bookcase,
        order: Number(bookcase.order ?? 0),
      }));
      state.bookcases = loaded.length ? loaded.sort((a, b) => a.order - b.order) : defaultBookcases;
      syncAllBookcaseSelects();
      refreshAll();
    });
  } catch (error) {
    state.firebaseReady = false;
    showToast("Firebase is not ready yet. Check the config values.");
    elements.loginStatus.textContent = "Firebase config is missing or incomplete.";
    console.error(error);
  }
}

function snapshotToArray(value) {
  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).map(([id, entry]) => ({ id, ...entry }));
}

function getBookcases() {
  return [...state.bookcases].sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
}

function getBookcaseLabel(bookcaseId) {
  const bookcase = getBookcases().find((item) => item.id === bookcaseId);
  return bookcase?.name ?? "Unsorted";
}

function normalizeReaders(readers) {
  if (!readers) {
    return [];
  }

  if (Array.isArray(readers)) {
    return readers.filter(Boolean);
  }

  if (typeof readers === "object") {
    return Object.values(readers).filter(Boolean);
  }

  return [];
}

function getFilteredBooks() {
  const query = state.search.trim().toLowerCase();

  return [...state.books]
    .filter((book) => {
      if (state.bookcaseFilter !== "all" && book.bookcaseId !== state.bookcaseFilter) {
        return false;
      }

      if (state.readerFilter !== "all" && !normalizeReaders(book.readers).includes(state.readerFilter)) {
        return false;
      }

      if (!query) {
        return true;
      }

      const haystack = [
        book.name,
        book.author,
        book.series,
        book.genre,
        book.notes,
        book.isbn,
        getBookcaseLabel(book.bookcaseId),
        ...normalizeReaders(book.readers),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function getReaderCounts() {
  return readerNames.map((reader) => ({
    reader,
    count: state.books.filter((book) => normalizeReaders(book.readers).includes(reader)).length,
  }));
}

function getBookcaseCounts() {
  return getBookcases().map((bookcase) => ({
    ...bookcase,
    count: state.books.filter((book) => book.bookcaseId === bookcase.id).length,
  }));
}

function getSummaryStats() {
  const totalBooks = state.books.length;
  const booksWithReaders = state.books.filter((book) => normalizeReaders(book.readers).length > 0).length;
  const totalReadingChecks = state.books.reduce((sum, book) => sum + normalizeReaders(book.readers).length, 0);

  return [
    { label: "Books", value: totalBooks, note: "titles in the catalogue" },
    { label: "Read books", value: booksWithReaders, note: "books with at least one reader" },
    { label: "Read checkmarks", value: totalReadingChecks, note: "all selected reader counts" },
  ];
}

function hashString(input) {
  return input.split("").reduce((total, char) => ((total << 5) - total + char.charCodeAt(0)) | 0, 0);
}

function pickColor(input) {
  const index = Math.abs(hashString(input)) % palette.length;
  return palette[index];
}

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

function createCoverMarkup(book) {
  if (book.coverImage) {
    return `<img src="${safeText(book.coverImage)}" alt="Cover for ${safeText(book.name)}" loading="lazy" />`;
  }

  return `<div class="fallback-cover">${safeText((book.name || "").slice(0, 2).toUpperCase() || "NB")}</div>`;
}

function createBookcaseCoverMarkup(bookcase) {
  if (bookcase.coverImage) {
    return `<img src="${safeText(bookcase.coverImage)}" alt="Cover for ${safeText(bookcase.name)}" loading="lazy" />`;
  }

  return `<div class="fallback-cover small">${safeText((bookcase.name || "").slice(0, 2).toUpperCase() || "BC")}</div>`;
}

function bookDetails(book) {
  return [
    ["Series", book.series || "Not set"],
    ["Purchased", book.datePurchased || "Not set"],
    ["Read", book.dateRead || "Not set"],
    ["Bookcase", getBookcaseLabel(book.bookcaseId)],
    ["Genre", book.genre || "Not set"],
    ["ISBN", book.isbn || "Not set"],
  ];
}

function refreshAll() {
  if (!state.unlocked) {
    return;
  }

  updateNavState();
  renderView();
  renderSummaryCards();
  renderAddView();
  renderBooks();
  renderStats();
}

function updateNavState() {
  elements.navButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view);
  });

  [elements.dashboardView, elements.booksView, elements.addView, elements.statsView].forEach((section) => {
    section.classList.toggle("active", section.id.startsWith(state.view));
  });
}

function renderView() {
  updateNavState();
}

function renderSummaryCards() {
  const summary = getSummaryStats();
  elements.summaryCards.innerHTML = summary
    .map(
      (item) => `
        <article class="stat-card">
          <p class="eyebrow">${safeText(item.label)}</p>
          <strong>${item.value}</strong>
          <p>${safeText(item.note)}</p>
        </article>
      `,
    )
    .join("");
}

function renderAddOptions(container) {
  const options = [
    { mode: "book", title: "Add book", copy: "Create a new catalogue entry." },
    { mode: "bookcase", title: "Add bookcase", copy: "Create a shelf with a cover image." },
    { mode: "read", title: "Add a read book", copy: "Record a book that has already been read." },
  ];

  container.innerHTML = options
    .map(
      (option) => `
        <button class="add-option-card" type="button" data-add-mode="${safeText(option.mode)}">
          <span class="eyebrow">${safeText(option.title)}</span>
          <strong>${safeText(option.title)}</strong>
          <p>${safeText(option.copy)}</p>
        </button>
      `,
    )
    .join("");

  container.querySelectorAll("[data-add-mode]").forEach((button) => {
    button.addEventListener("click", () => openAddWorkspace(button.dataset.addMode));
  });
}

function renderAddView() {
  renderAddOptions(elements.addOptionsGrid);
  renderAddOptions(elements.quickAddOptions);
  renderCurrentBookcases();
  if (state.addMode) {
    if (state.addRenderedMode !== state.addMode || !elements.addWorkspace.childElementCount) {
      renderAddWorkspace(state.addMode);
    }
  } else if (elements.addWorkspace) {
    elements.addWorkspace.innerHTML = `<div class="empty-state"><h3>Choose an add option.</h3><p>Pick book, bookcase, or a read book to open its form.</p></div>`;
  }
}

function renderCurrentBookcases() {
  const bookcases = getBookcaseCounts();

  if (!bookcases.length) {
    elements.bookcaseLibraryGrid.innerHTML = `<div class="empty-state"><h3>No bookcases yet</h3><p>Add a bookcase to start collecting shelf covers.</p></div>`;
    return;
  }

  elements.bookcaseLibraryGrid.innerHTML = bookcases
    .map((bookcase) => `
      <article class="bookcase-library-card">
        <div class="bookcase-cover">${createBookcaseCoverMarkup(bookcase)}</div>
        <div class="bookcase-library-copy">
          <p class="eyebrow">${safeText(bookcase.name)}</p>
          <strong>${bookcase.count} books</strong>
          <p>${safeText(bookcase.note || "Shelf")}</p>
        </div>
      </article>
    `)
    .join("");
}

function renderBooks() {
  const books = getFilteredBooks();
  elements.booksCountLabel.textContent = `${books.length} matching book${books.length === 1 ? "" : "s"}`;

  if (!books.length) {
    elements.booksGrid.innerHTML = `<div class="empty-state"><h3>No books match this search.</h3><p>Try clearing a filter or searching a different title, author, or reader.</p></div>`;
    return;
  }

  elements.booksGrid.innerHTML = books.map((book) => renderBookCard(book)).join("");
  elements.booksGrid.querySelectorAll("[data-book-id]").forEach((card) => {
    card.addEventListener("click", () => openBookModal(card.dataset.bookId));
  });
}

function renderBookCard(book) {
  const readers = normalizeReaders(book.readers);
  const label = getBookcaseLabel(book.bookcaseId);

  return `
    <article class="book-card" data-book-id="${safeText(book.id)}" tabindex="0" role="button" aria-label="Open ${safeText(book.name)}">
      <div class="book-cover">${createCoverMarkup(book)}</div>
      <div>
        <h4>${safeText(book.name)}</h4>
        <p class="book-meta">${safeText(book.author)}</p>
      </div>
      <div class="pill-row">
        <span class="pill">${safeText(label)}</span>
        <span class="pill">${readers.length} reader${readers.length === 1 ? "" : "s"}</span>
      </div>
    </article>
  `;
}

function renderStats() {
  const readerCounts = getReaderCounts();

  elements.readerStatsGrid.innerHTML = readerCounts
    .map(
      (reader) => `
        <button class="metric-card reader-card" type="button" data-reader-name="${safeText(reader.reader)}">
          <p class="eyebrow">${safeText(reader.reader)}</p>
          <strong>${reader.count}</strong>
          <p>books marked as read</p>
        </button>
      `,
    )
    .join("");

  elements.readerStatsGrid.querySelectorAll("[data-reader-name]").forEach((button) => {
    button.addEventListener("click", () => openReaderStats(button.dataset.readerName));
  });

  if (!state.selectedReader && readerCounts.length) {
    state.selectedReader = readerCounts[0].reader;
  }

  renderReaderDetail(state.selectedReader || readerCounts[0]?.reader || readerNames[0]);
}

function getReaderStats(readerName) {
  const booksForReader = state.books.filter((book) => normalizeReaders(book.readers).includes(readerName));
  const bookcaseCounts = booksForReader.reduce((accumulator, book) => {
    const label = getBookcaseLabel(book.bookcaseId);
    accumulator[label] = (accumulator[label] || 0) + 1;
    return accumulator;
  }, {});
  const authorCounts = booksForReader.reduce((accumulator, book) => {
    const author = book.author || "Unknown";
    accumulator[author] = (accumulator[author] || 0) + 1;
    return accumulator;
  }, {});

  const favoriteBookcase = Object.entries(bookcaseCounts).sort((a, b) => b[1] - a[1])[0];
  const favoriteAuthor = Object.entries(authorCounts).sort((a, b) => b[1] - a[1])[0];

  return {
    readerName,
    totalRead: booksForReader.length,
    favoriteBookcase: favoriteBookcase?.[0] || "No bookcase yet",
    favoriteBookcaseCount: favoriteBookcase?.[1] || 0,
    favoriteAuthor: favoriteAuthor?.[0] || "No author yet",
    favoriteAuthorCount: favoriteAuthor?.[1] || 0,
    bookcaseCounts,
    booksForReader,
    recentBooks: booksForReader.slice().sort((left, right) => (right.dateRead || right.updatedAt || "").localeCompare(left.dateRead || left.updatedAt || "")).slice(0, 5),
  };
}

function renderReaderDetail(readerName) {
  const stats = getReaderStats(readerName);
  const bookcaseEntries = Object.entries(stats.bookcaseCounts).sort((a, b) => b[1] - a[1]);

  elements.readerDetailPanel.innerHTML = `
    <article class="reader-detail-card">
      <div class="panel-header">
        <div>
          <p class="eyebrow">${safeText(stats.readerName)}</p>
          <h3>${stats.totalRead} books read</h3>
        </div>
        <span class="pill">Selected reader</span>
      </div>
      <div class="detail-grid">
        <div class="detail-field"><span>Most read bookcase</span><strong>${safeText(stats.favoriteBookcase)}</strong><p>${stats.favoriteBookcaseCount} book${stats.favoriteBookcaseCount === 1 ? "" : "s"}</p></div>
        <div class="detail-field"><span>Most read author</span><strong>${safeText(stats.favoriteAuthor)}</strong><p>${stats.favoriteAuthorCount} book${stats.favoriteAuthorCount === 1 ? "" : "s"}</p></div>
      </div>
      <div class="detail-field">
        <span>Bookcase breakdown</span>
        <div class="pill-row">
          ${bookcaseEntries.length ? bookcaseEntries.map(([name, count]) => `<span class="mini-pill">${safeText(name)} · ${count}</span>`).join("") : "<span class='pill'>No bookcases yet</span>"}
        </div>
      </div>
      <div class="detail-field">
        <span>Recent books</span>
        <div class="recent-list">
          ${stats.recentBooks.length ? stats.recentBooks.map((book) => `<button class="recent-book-btn" type="button" data-recent-book="${safeText(book.id)}">${safeText(book.name)} <small>${safeText(getBookcaseLabel(book.bookcaseId))}</small></button>`).join("") : "<p>No books recorded yet.</p>"}
        </div>
      </div>
    </article>
  `;

  elements.readerDetailPanel.querySelectorAll("[data-recent-book]").forEach((button) => {
    button.addEventListener("click", () => openBookModal(button.dataset.recentBook));
  });
}

function openReaderStats(readerName) {
  state.selectedReader = readerName;
  renderReaderDetail(readerName);
}

function setView(view) {
  state.view = view;
  refreshAll();
}

function openAddMenu() {
  state.addMenuOpen = true;
  elements.quickAddMenu.classList.remove("hidden");
  elements.quickAddMenu.setAttribute("aria-hidden", "false");
}

function closeAddMenu() {
  state.addMenuOpen = false;
  elements.quickAddMenu.classList.add("hidden");
  elements.quickAddMenu.setAttribute("aria-hidden", "true");
}

function openAddWorkspace(mode) {
  state.addMode = mode;
  closeAddMenu();
  setView("add");
  renderAddWorkspace(mode);
}

function renderAddWorkspace(mode) {
  state.addRenderedMode = mode;
  if (mode === "bookcase") {
    const { element, form, coverPreview } = createBookcaseForm();
    bookcaseForm = form;
    elements.addWorkspace.replaceChildren(element);
    populateBookcaseForm(form, {});
    updateBookcasePreview(coverPreview, "", form.elements.name.value || "Bookcase");
    return;
  }

  const { element, form, coverPreview } = createBookForm(mode);
  editForm = null;
  elements.addWorkspace.replaceChildren(element);
  populateForm(form, {});
  if (mode === "read") {
    form.elements.dateRead.value = new Date().toISOString().slice(0, 10);
  }
  updateCoverPreview(coverPreview, "", "");
}

function renderAddPageDefault() {
  if (!state.addMode) {
    elements.addWorkspace.innerHTML = `<div class="empty-state"><h3>Choose an add option.</h3><p>Open a form from the cards above or the Add menu.</p></div>`;
  }
}

function openBookModal(bookId) {
  state.modalBookId = bookId;
  const book = state.books.find((entry) => entry.id === bookId);

  if (!book) {
    return;
  }

  elements.bookModal.classList.remove("hidden");
  elements.bookModal.setAttribute("aria-hidden", "false");
  renderDetailSummary(book);

  if (editForm) {
    populateForm(editForm, book);
  }
}

function closeBookModal() {
  state.modalBookId = null;
  elements.bookModal.classList.add("hidden");
  elements.bookModal.setAttribute("aria-hidden", "true");
}

function renderDetailSummary(book) {
  const readers = normalizeReaders(book.readers);
  elements.bookDetailSummary.innerHTML = `
    <section class="detail-summary">
      <div class="detail-pills">
        <span class="pill">${safeText(getBookcaseLabel(book.bookcaseId))}</span>
        <span class="pill">${readers.length} reader${readers.length === 1 ? "" : "s"}</span>
      </div>
      <h3>${safeText(book.name)}</h3>
      <p>${safeText(book.author)}</p>
      <div class="detail-grid">
        ${bookDetails(book)
          .map(
            ([label, value]) => `
              <div class="detail-field">
                <span>${safeText(label)}</span>
                <strong>${safeText(value)}</strong>
              </div>
            `,
          )
          .join("")}
      </div>
      <div class="detail-field">
        <span>Who has read this?</span>
        <div class="pill-row">${readers.length ? readers.map((reader) => `<span class="mini-pill">${safeText(reader)}</span>`).join("") : "<span class='pill'>No readers selected yet</span>"}</div>
      </div>
      <div class="detail-actions">
        <button class="secondary-btn" type="button" data-delete-book>Delete book</button>
        <button class="primary-btn" type="button" data-close-modal>Close</button>
      </div>
    </section>
  `;
}

function createBookForm(mode) {
  const template = elements.bookFormTemplate.content.cloneNode(true);
  const shell = template.querySelector(".book-form-shell");
  const kicker = template.querySelector("[data-form-kicker]");
  const title = template.querySelector("[data-form-title]");
  const copy = template.querySelector("[data-form-copy]");
  const form = template.querySelector("form");
  const submitLabel = template.querySelector("[data-submit-label]");
  const resetButton = template.querySelector("[data-reset-form]");
  const coverInput = form.elements.coverImage;
  const coverPreview = template.querySelector("[data-cover-preview]");

  kicker.textContent = mode === "edit" ? "Edit book" : "New record";
  title.textContent = mode === "edit" ? "Change every detail" : "Create a new book entry";
  copy.textContent = mode === "edit"
    ? "Update anything from the title to the readers list, then save straight into Firebase."
    : mode === "read"
      ? "Record a book that has already been read and choose the readers who finished it."
      : "Name and author are required. Everything else can be added now or later.";
  submitLabel.textContent = mode === "edit" ? "Save changes" : mode === "read" ? "Save read book" : "Add book";
  resetButton.textContent = mode === "edit" ? "Revert" : "Clear form";

  renderBookcaseOptions(form);

  shell.insertAdjacentHTML(
    "afterbegin",
    `<div class="form-topline"><button class="secondary-btn" type="button" data-back-to-add>Back to Add</button></div>`,
  );

  coverInput.addEventListener("input", () => updateCoverPreview(coverPreview, coverInput.value, form.elements.name.value));
  form.elements.name.addEventListener("input", () => {
    if (!coverInput.value) {
      updateCoverPreview(coverPreview, "", form.elements.name.value);
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await handleFormSubmit(form, mode);
  });

  resetButton.addEventListener("click", () => {
    if (mode === "edit" && state.modalBookId) {
      const original = state.books.find((book) => book.id === state.modalBookId);
      if (original) {
        populateForm(form, original);
      }
      return;
    }

    form.reset();
    updateCoverPreview(coverPreview, "", "");
  });

  shell.addEventListener("change", () => {
    if (mode === "edit" && state.modalBookId) {
      const original = state.books.find((book) => book.id === state.modalBookId);
      if (original) {
        updateCoverPreview(coverPreview, coverInput.value, form.elements.name.value || original.name);
      }
    }
  });

  return { element: shell, form, coverPreview };
}

function createBookcaseForm() {
  const template = elements.bookcaseFormTemplate.content.cloneNode(true);
  const shell = template.querySelector(".book-form-shell");
  const kicker = template.querySelector("[data-form-kicker]");
  const title = template.querySelector("[data-form-title]");
  const copy = template.querySelector("[data-form-copy]");
  const form = template.querySelector("form");
  const resetButton = template.querySelector("[data-reset-form]");
  const coverPreview = template.querySelector("[data-cover-preview]");

  kicker.textContent = "Add bookcase";
  title.textContent = "Create a new shelf";
  copy.textContent = "Add a cover image, accent color, and note for this bookcase.";

  shell.insertAdjacentHTML(
    "afterbegin",
    `<div class="form-topline"><button class="secondary-btn" type="button" data-back-to-add>Back to Add</button></div>`,
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await handleBookcaseSubmit(form);
  });

  form.elements.name.addEventListener("input", () => updateBookcasePreview(coverPreview, form.elements.coverImage.value, form.elements.name.value));
  form.elements.coverImage.addEventListener("input", () => updateBookcasePreview(coverPreview, form.elements.coverImage.value, form.elements.name.value));

  resetButton.addEventListener("click", () => {
    form.reset();
    updateBookcasePreview(coverPreview, "", "Bookcase");
  });

  return { element: shell, form, coverPreview };
}

function populateBookcaseForm(form, bookcase) {
  form.elements.name.value = bookcase?.name ?? "";
  form.elements.coverImage.value = bookcase?.coverImage ?? "";
  form.elements.accent.value = bookcase?.accent ?? "#79b6af";
  form.elements.order.value = bookcase?.order ?? (state.bookcases.length + 1 || 1);
  form.elements.note.value = bookcase?.note ?? "";
}

function updateBookcasePreview(container, url, title) {
  if (!container) {
    return;
  }

  if (url) {
    container.innerHTML = `<img src="${safeText(url)}" alt="Preview cover for ${safeText(title || "bookcase")}" loading="lazy" />`;
    return;
  }

  container.innerHTML = `<div class="cover-placeholder"><strong>${safeText(title ? title.slice(0, 2).toUpperCase() : "BC")}</strong><p>${safeText(title || "Add a cover image URL for your shelf")}</p></div>`;
}

function renderBookcaseOptions(form) {
  const select = form.elements.bookcaseId;
  const options = getBookcases();
  select.innerHTML = [
    `<option value="">Unsorted</option>`,
    ...options.map((bookcase) => `<option value="${safeText(bookcase.id)}">${safeText(bookcase.name)}</option>`),
  ].join("");
}

function syncAllBookcaseSelects() {
  [addForm, editForm].filter(Boolean).forEach((form) => {
    const currentValue = form.elements.bookcaseId.value;
    renderBookcaseOptions(form);
    if (currentValue) {
      form.elements.bookcaseId.value = currentValue;
    }
  });

  elements.bookcaseFilter.innerHTML = [
    `<option value="all">All bookcases</option>`,
    ...getBookcases().map((bookcase) => `<option value="${safeText(bookcase.id)}">${safeText(bookcase.name)}</option>`),
  ].join("");

  elements.readerFilter.innerHTML = [
    `<option value="all">All readers</option>`,
    ...readerNames.map((reader) => `<option value="${safeText(reader)}">${safeText(reader)}</option>`),
  ].join("");
}

function populateForm(form, book) {
  form.dataset.bookId = book?.id ?? "";
  form.elements.name.value = book?.name ?? "";
  form.elements.author.value = book?.author ?? "";
  form.elements.series.value = book?.series ?? "";
  form.elements.bookcaseId.value = book?.bookcaseId ?? "";
  form.elements.datePurchased.value = book?.datePurchased ?? "";
  form.elements.dateRead.value = book?.dateRead ?? "";
  form.elements.genre.value = book?.genre ?? "";
  form.elements.isbn.value = book?.isbn ?? "";
  form.elements.coverImage.value = book?.coverImage ?? "";
  form.elements.notes.value = book?.notes ?? "";

  const selectedReaders = new Set(normalizeReaders(book?.readers));
  form.querySelectorAll('input[name="readers"]').forEach((checkbox) => {
    checkbox.checked = selectedReaders.has(checkbox.value);
  });

  const coverPreview = form.querySelector("[data-cover-preview]");
  updateCoverPreview(coverPreview, form.elements.coverImage.value, form.elements.name.value);
}

function updateCoverPreview(container, url, title) {
  if (!container) {
    return;
  }

  if (url) {
    container.innerHTML = `<img src="${safeText(url)}" alt="Preview cover for ${safeText(title || "book")}" loading="lazy" />`;
    return;
  }

  container.innerHTML = `
    <div class="cover-placeholder">
      <strong>${safeText(title ? title.slice(0, 2).toUpperCase() : "NB")}</strong>
      <p>${safeText(title || "Add a cover image URL for a preview")}</p>
    </div>
  `;
}

function getFormPayload(form) {
  const readers = [...form.querySelectorAll('input[name="readers"]:checked')].map((checkbox) => checkbox.value);

  return {
    name: form.elements.name.value.trim(),
    author: form.elements.author.value.trim(),
    series: form.elements.series.value.trim(),
    bookcaseId: form.elements.bookcaseId.value || "",
    datePurchased: form.elements.datePurchased.value || "",
    dateRead: form.elements.dateRead.value || "",
    genre: form.elements.genre.value.trim(),
    isbn: form.elements.isbn.value.trim(),
    coverImage: form.elements.coverImage.value.trim(),
    notes: form.elements.notes.value.trim(),
    readers,
    updatedAt: new Date().toISOString(),
  };
}

async function handleFormSubmit(form, mode) {
  if (!state.firebaseReady || !booksRef) {
    showToast("Firebase is not connected yet.");
    return;
  }

  if (!form.elements.name.value.trim() || !form.elements.author.value.trim()) {
    showToast("Name and author are required.");
    return;
  }

  const payload = getFormPayload(form);

  try {
    if (mode === "edit" && state.modalBookId) {
      await update(ref(database, `books/${state.modalBookId}`), payload);
      showToast("Book updated.");
      closeBookModal();
    } else {
      const newEntry = push(booksRef);
      await set(newEntry, {
        ...payload,
        createdAt: new Date().toISOString(),
      });
      form.reset();
      updateCoverPreview(form.querySelector("[data-cover-preview]"), "", "");
      showToast("Book added.");
      state.addMode = null;
      state.addRenderedMode = null;
      setView("books");
    }
  } catch (error) {
    console.error(error);
    showToast("That save did not complete.");
  }
}

async function handleBookcaseSubmit(form) {
  if (!state.firebaseReady || !bookcasesRef) {
    showToast("Firebase is not connected yet.");
    return;
  }

  if (!form.elements.name.value.trim()) {
    showToast("Bookcase name is required.");
    return;
  }

  try {
    const entry = push(bookcasesRef);
    await set(entry, {
      name: form.elements.name.value.trim(),
      coverImage: form.elements.coverImage.value.trim(),
      accent: form.elements.accent.value || "#79b6af",
      order: Number(form.elements.order.value || state.bookcases.length + 1),
      note: form.elements.note.value.trim(),
      createdAt: new Date().toISOString(),
    });
    showToast("Bookcase added.");
    form.reset();
    updateBookcasePreview(form.querySelector("[data-cover-preview]"), "", "Bookcase");
    state.addMode = null;
    state.addRenderedMode = null;
    if (state.view === "add") {
      renderAddView();
    }
  } catch (error) {
    console.error(error);
    showToast("That bookcase save did not complete.");
  }
}

function mountForms() {
  const edit = createBookForm("edit");
  editForm = edit.form;
  elements.editFormMount.replaceChildren(edit.element);
  populateForm(editForm, {});
  updateCoverPreview(edit.coverPreview, "", "");
  renderAddView();
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  elements.toastStack.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2500);
}

function handleKeypadPress(value, action) {
  if (action === "clear") {
    state.passcodeBuffer = "";
    updatePasscodeUI();
    elements.loginStatus.textContent = "Cleared. Enter four digits to unlock the shelf.";
    return;
  }

  if (action === "backspace") {
    state.passcodeBuffer = state.passcodeBuffer.slice(0, -1);
    updatePasscodeUI();
    return;
  }

  if (!value || state.passcodeBuffer.length >= 4) {
    return;
  }

  state.passcodeBuffer += value;
  updatePasscodeUI();

  if (state.passcodeBuffer.length === 4) {
    if (state.passcodeBuffer === expectedPasscode) {
      unlockSite();
    } else {
      elements.loginStatus.textContent = "That code is not correct. Try again.";
      elements.loginOverlay.querySelector(".login-card").classList.add("shake");
      window.setTimeout(() => {
        elements.loginOverlay.querySelector(".login-card").classList.remove("shake");
        state.passcodeBuffer = "";
        updatePasscodeUI();
      }, 320);
    }
  }
}

function updatePasscodeUI() {
  elements.dots.forEach((dot, index) => {
    dot.classList.toggle("filled", index < state.passcodeBuffer.length);
  });
}

function unlockSite() {
  state.unlocked = true;
  elements.loginOverlay.classList.add("hidden");
  elements.loginStatus.textContent = "";
  state.passcodeBuffer = "";
  updatePasscodeUI();
  mountForms();
  syncAllBookcaseSelects();
  refreshAll();
  showToast("Unlocked.");
}

function bindEvents() {
  elements.keypad.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-digit], button[data-action]");
    if (!button) {
      return;
    }

    handleKeypadPress(button.dataset.digit, button.dataset.action);
  });

  elements.navButtons.forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  elements.searchInput.addEventListener("input", () => {
    state.search = elements.searchInput.value;
    refreshAll();
  });

  elements.bookcaseFilter.addEventListener("change", () => {
    state.bookcaseFilter = elements.bookcaseFilter.value;
    renderBooks();
  });

  elements.readerFilter.addEventListener("change", () => {
    state.readerFilter = elements.readerFilter.value;
    renderBooks();
  });

  elements.clearFilters.addEventListener("click", () => {
    state.bookcaseFilter = "all";
    state.readerFilter = "all";
    state.search = "";
    elements.searchInput.value = "";
    elements.bookcaseFilter.value = "all";
    elements.readerFilter.value = "all";
    refreshAll();
  });

  elements.openAddBookTop.addEventListener("click", () => {
    if (state.view !== "add") {
      setView("add");
    }
    openAddMenu();
  });

  elements.quickAddMenu.addEventListener("click", (event) => {
    if (event.target.matches("[data-close-add-menu]")) {
      closeAddMenu();
      return;
    }

    const button = event.target.closest("[data-add-mode]");
    if (button) {
      openAddWorkspace(button.dataset.addMode);
    }
  });

  elements.addWorkspace.addEventListener("click", (event) => {
    if (event.target.matches("[data-back-to-add]") ) {
      state.addMode = null;
      renderAddView();
    }
  });

  elements.bookModal.addEventListener("click", (event) => {
    if (event.target.matches("[data-delete-book]")) {
      deleteCurrentBook();
      return;
    }

    if (event.target.matches("[data-close-modal]")) {
      closeBookModal();
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.quickAddMenu.classList.contains("hidden")) {
      closeAddMenu();
      return;
    }

    if (event.key === "Escape" && !elements.bookModal.classList.contains("hidden")) {
      closeBookModal();
    }
  });
}

async function deleteCurrentBook() {
  if (!state.modalBookId || !state.firebaseReady) {
    return;
  }

  const book = state.books.find((entry) => entry.id === state.modalBookId);
  const confirmed = window.confirm(`Delete ${book?.name ?? "this book"}? This cannot be undone.`);

  if (!confirmed) {
    return;
  }

  try {
    await remove(ref(database, `books/${state.modalBookId}`));
    showToast("Book deleted.");
    closeBookModal();
  } catch (error) {
    console.error(error);
    showToast("That delete did not complete.");
  }
}

function renderInitialEmptyState() {
  elements.summaryCards.innerHTML = `
    <article class="stat-card"><p class="eyebrow">Loading</p><strong>...</strong><p>Waiting for the library data.</p></article>
  `;
  elements.booksGrid.innerHTML = `<div class="empty-state"><h3>Loading books...</h3><p>The app is connecting to Firebase.</p></div>`;
  elements.readerStatsGrid.innerHTML = `<div class="empty-state"><h3>Loading stats...</h3><p>The app is connecting to Firebase.</p></div>`;
  elements.readerDetailPanel.innerHTML = `<div class="empty-state"><h3>Loading people...</h3><p>The app is connecting to Firebase.</p></div>`;
  elements.addOptionsGrid.innerHTML = `<div class="empty-state"><h3>Loading add options...</h3><p>The app is connecting to Firebase.</p></div>`;
  elements.bookcaseLibraryGrid.innerHTML = `<div class="empty-state"><h3>Loading bookcases...</h3><p>The app is connecting to Firebase.</p></div>`;
}

function init() {
  bindEvents();
  renderInitialEmptyState();
  updatePasscodeUI();
  initFirebase();
  state.unlocked = false;
  state.addMode = null;
  state.addRenderedMode = null;
}

init();