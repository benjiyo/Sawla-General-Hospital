// Sticky navbar & parallax hero background
const navbar = document.getElementById("navbar");
const heroBg = document.querySelector(".hero-bg");

window.addEventListener("scroll", () => {
  const scrollY = window.scrollY || window.pageYOffset;
  if (navbar) {
    navbar.classList.toggle("scrolled", scrollY > 10);
  }
  if (heroBg) {
    heroBg.style.transform = `translateY(${scrollY * 0.2}px)`;
  }
});

// Mobile navigation toggling
const navToggle = document.getElementById("navToggle");
const navLinks = document.getElementById("navLinks");
const themeToggle = document.getElementById("themeToggle");
const themeIcon = themeToggle ? themeToggle.querySelector(".theme-icon") : null;
const themeLabel = themeToggle
  ? themeToggle.querySelector(".theme-label")
  : null;

if (navToggle && navLinks) {
  navToggle.addEventListener("click", () => {
    navLinks.classList.toggle("open");
  });

  navLinks.addEventListener("click", (e) => {
    if (e.target.tagName === "A") {
      navLinks.classList.remove("open");
    }
  });
}

// Theme switching
const userStoredTheme = localStorage.getItem("sawla-theme");
const prefersDark =
  window.matchMedia &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;
const initialTheme = userStoredTheme || (prefersDark ? "dark" : "light");

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  if (themeIcon && themeLabel) {
    if (theme === "dark") {
      themeIcon.textContent = "🌙";
      themeLabel.textContent = "Dark";
    } else {
      themeIcon.textContent = "🌞";
      themeLabel.textContent = "Light";
    }
  }
  localStorage.setItem("sawla-theme", theme);
}

applyTheme(initialTheme);

themeToggle?.addEventListener("click", () => {
  const newTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(newTheme);
});

// Intersection Observer for scroll reveal
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  },
  {
    threshold: 0.15,
  }
);

document.querySelectorAll(".fade-in-up").forEach((el) => observer.observe(el));

// Animated counters on hero
function animateCounters() {
  const counters = document.querySelectorAll(".counter");
  counters.forEach((counter) => {
    const target = Number(counter.getAttribute("data-target")) || 0;
    let current = 0;
    const duration = 1200;
    const startTime = performance.now();

    function update(now) {
      const progress = Math.min((now - startTime) / duration, 1);
      current = Math.floor(target * progress);
      counter.textContent = current.toLocaleString();
      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        counter.textContent = target.toLocaleString();
      }
    }

    requestAnimationFrame(update);
  });
}

window.addEventListener("load", animateCounters);

// Testimonials slider
const slider = document.getElementById("testimonialSlider");
if (slider) {
  const cards = slider.querySelectorAll(".testimonial-card");
  const dots = slider.querySelectorAll(".slider-dot");
  let currentIndex = 0;
  let intervalId;

  function showSlide(index) {
    cards.forEach((card, i) => {
      card.classList.toggle("active", i === index);
    });
    dots.forEach((dot, i) => {
      dot.classList.toggle("active", i === index);
    });
    currentIndex = index;
  }

  function nextSlide() {
    const nextIndex = (currentIndex + 1) % cards.length;
    showSlide(nextIndex);
  }

  dots.forEach((dot) => {
    dot.addEventListener("click", () => {
      const slide = Number(dot.getAttribute("data-slide")) || 0;
      showSlide(slide);
      if (intervalId) {
        clearInterval(intervalId);
      }
      intervalId = setInterval(nextSlide, 7000);
    });
  });

  intervalId = setInterval(nextSlide, 7000);
}

// Accordion behaviour on Services page
document.querySelectorAll(".accordion-card").forEach((card) => {
  const header = card.querySelector(".accordion-header");
  const body = card.querySelector(".accordion-body");
  if (!header || !body) return;

  header.addEventListener("click", () => {
    const isOpen = card.classList.contains("open");
    document.querySelectorAll(".accordion-card.open").forEach((other) => {
      other.classList.remove("open");
      const otherBody = other.querySelector(".accordion-body");
      if (otherBody) otherBody.style.maxHeight = null;
    });
    if (!isOpen) {
      card.classList.add("open");
      body.style.maxHeight = body.scrollHeight + "px";
    }
  });
});

// Contact form submission with basic validation
const contactForm = document.getElementById("contactForm");
const contactMessage = document.getElementById("contactMessage");

if (contactForm && contactMessage) {
  contactForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    contactMessage.textContent = "";
    contactMessage.className = "form-message";

    const formData = new FormData(contactForm);
    const payload = Object.fromEntries(formData.entries());

    if (!payload.name || !payload.email || !payload.message) {
      contactMessage.textContent = "Please fill in all required fields.";
      contactMessage.classList.add("error");
      return;
    }

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        contactMessage.textContent =
          data.message || "Message sent successfully.";
        contactMessage.classList.add("success");
        contactForm.reset();
      } else {
        contactMessage.textContent =
          data.message || "Something went wrong. Please try again.";
        contactMessage.classList.add("error");
      }
    } catch (err) {
      contactMessage.textContent =
        "Unable to send message at this time. Please try again later.";
      contactMessage.classList.add("error");
    }
  });
}

// Load doctors into About page grid
async function loadDoctors() {
  try {
    console.debug("loadDoctors: start");
    // Try API endpoint first (production). If that fails, fall back to local JSON for static sites.
    let doctors = null;
    try {
      const res = await fetch("/api/doctors");
      const data = await res.json();
      if (data && data.success && Array.isArray(data.data)) {
        doctors = data.data;
      }
    } catch (err) {
      console.debug("loadDoctors: /api/doctors fetch failed", err);
      // ignore and try local file
    }

    if (!doctors) {
      // From pages inside `html/`, the JSON lives at `../data/doctor.json`.
      // Try a couple of relative locations to be resilient to different hosting setups.
      const fallbacks = [
        "../data/doctor.json",
        "/data/doctor.json",
        "data/doctor.json",
      ];
      for (const path of fallbacks) {
        try {
          const r = await fetch(path);
          if (!r.ok) continue;
          const j = await r.json();
          if (Array.isArray(j)) {
            doctors = j;
            break;
          }
          // Some JSON files may wrap data: { data: [...] }
          if (j && Array.isArray(j.data)) {
            doctors = j.data;
            break;
          }
        } catch (e) {
          console.debug("loadDoctors: fallback fetch failed", path, e);
          // continue to next fallback
        }
      }

      // Stronger final attempt: try absolute /data/doctor.json
      if (!doctors) {
        try {
          const r2 = await fetch("/data/doctor.json");
          if (r2.ok) {
            const j2 = await r2.json();
            if (Array.isArray(j2)) doctors = j2;
            else if (j2 && Array.isArray(j2.data)) doctors = j2.data;
          }
        } catch (e) {
          console.debug("loadDoctors: final /data/doctor.json fetch failed", e);
        }
      }
    }
    if (!doctors || !Array.isArray(doctors)) {
      console.debug("loadDoctors: no doctors data found");
      return; // Don't clear existing content if we can't load doctors
    }
    const doctorGrid = document.getElementById("doctorGrid");

    if (doctorGrid && doctors.length > 0) {
      doctorGrid.innerHTML = "";
      doctors.forEach((doc) => {
        // Normalize photo paths so they work from files served from `html/`.
        // If photo starts with '/', treat it as server-root and convert to relative '../'.
        let photo = doc.photo || "../images/doctors/placeholder.svg";
        if (typeof photo === "string") {
          photo = photo.trim();
          if (photo.startsWith("/")) {
            photo = "../" + photo.slice(1);
          } else if (
            !photo.startsWith("http") &&
            !photo.startsWith("../") &&
            !photo.startsWith("./")
          ) {
            // assume images are in ../images relative to html pages
            photo = "../" + photo;
          }
          // If path already has ../, ensure it's correct (don't double it)
          // Paths from JSON should already be correct relative to html/ folder
        }
        const card = document.createElement("article");
        card.className = "card doctor-card fade-in-up";
        card.innerHTML = `
          <div class="doctor-photo">
            <img src="${photo}" alt="${doc.name}" loading="lazy" onerror="this.onerror=null;this.src='../images/doctors/placeholder.svg';" />
          </div>
          <div class="doctor-body">
            <h3>${doc.name}</h3>
            <p class="doctor-meta">${doc.specialty} • ${doc.department}</p>
            <p>${doc.bio}</p>
            <p class="doctor-meta">Experience: ${doc.experience}</p>
          </div>
        `;
        doctorGrid.appendChild(card);
        observer.observe(card);
      });
      // After populating, enable interactive behaviors for the grid/cards
      enableDoctorGridInteractions(doctorGrid);
    }

  } catch (err) {
    // Silent fail to keep UI smooth
  }
}

window.addEventListener("load", loadDoctors);
window.addEventListener("load", loadNews);
window.addEventListener("load", enableHistoryGallery);


// Enable drag-to-scroll on the doctor grid and a subtle 3D tilt on cards
function enableDoctorGridInteractions(grid) {
  if (!grid) return;

  // Make grid horizontally scrollable if content overflows (helps on small screens)
  grid.style.overflowX = "auto";
  grid.classList.add("draggable");

  // Drag to scroll
  let isDown = false;
  let startX;
  let scrollLeft;

  grid.addEventListener("mousedown", (e) => {
    isDown = true;
    grid.classList.add("active");
    startX = e.pageX - grid.offsetLeft;
    scrollLeft = grid.scrollLeft;
    e.preventDefault();
  });

  grid.addEventListener("mouseleave", () => {
    isDown = false;
    grid.classList.remove("active");
  });

  grid.addEventListener("mouseup", () => {
    isDown = false;
    grid.classList.remove("active");
  });

  grid.addEventListener("mousemove", (e) => {
    if (!isDown) return;
    const x = e.pageX - grid.offsetLeft;
    const walk = (x - startX) * 1; // scroll-fast multiplier
    grid.scrollLeft = scrollLeft - walk;
  });

  // Touch support
  let touchStartX = 0;
  let touchScrollLeft = 0;
  grid.addEventListener("touchstart", (e) => {
    touchStartX = e.touches[0].pageX - grid.offsetLeft;
    touchScrollLeft = grid.scrollLeft;
  });
  grid.addEventListener("touchmove", (e) => {
    const x = e.touches[0].pageX - grid.offsetLeft;
    const walk = (x - touchStartX) * 1;
    grid.scrollLeft = touchScrollLeft - walk;
  });

  // Subtle 3D tilt on cards based on mouse position
  const cards = grid.querySelectorAll(".doctor-card");
  cards.forEach((card) => {
    card.addEventListener("mousemove", (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left; // x position within the card
      const y = e.clientY - rect.top; // y position within the card
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const dx = (x - cx) / cx; // -1 .. 1
      const dy = (y - cy) / cy; // -1 .. 1
      const rotateY = dx * 6; // degrees
      const rotateX = -dy * 6; // degrees
      card.style.transform = `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-8px)`;
    });
    card.addEventListener("mouseleave", () => {
      card.style.transform = "";
    });
  });
}

// Footer year
const yearSpan = document.getElementById("year");
if (yearSpan) {
  yearSpan.textContent = new Date().getFullYear();
}

// Load news items into About page `.news-grid`
async function loadNews() {
  try {
    let news = null;
    // try server API first
    try {
      const res = await fetch("/api/news");
      const j = await res.json();
      if (j && Array.isArray(j)) news = j;
      else if (j && Array.isArray(j.data)) news = j.data;
    } catch (e) {
      // ignore
    }

    if (!news) {
      const fallbacks = [
        "../data/news.json",
        "/data/news.json",
        "data/news.json",
      ];
      for (const p of fallbacks) {
        try {
          const r = await fetch(p);
          if (!r.ok) continue;
          const j = await r.json();
          if (Array.isArray(j)) {
            news = j;
            break;
          }
          if (j && Array.isArray(j.data)) {
            news = j.data;
            break;
          }
        } catch (err) {
          // continue
        }
      }
    }

    if (!news || !Array.isArray(news)) return;

    const grid = document.querySelector(".news-grid");
    if (!grid) return;
    grid.innerHTML = "";

    // Render each item
    news.forEach((item) => {
      const dateText = item.date || item.publish_date || item.month || "";
      const title = item.title || item.heading || "";
      const excerpt = item.excerpt || item.summary || item.description || "";
      const image = item.image || item.img || null;

      const article = document.createElement("article");
      article.className = "card news-card fade-in-up";

      let imgHtml = "";
      if (image) {
        // normalize path for pages under `html/`
        let src = image;
        if (typeof src === "string") {
          src = src.trim();
          if (src.startsWith("/")) src = ".." + src;
          else if (
            !src.startsWith("..") &&
            !src.startsWith("./") &&
            !src.startsWith("http")
          )
            src = ".." + (src.startsWith("/") ? "" : "/") + src;
        }
        imgHtml = `<div class="news-photo"><img src="${src}" alt="${title}" loading="lazy" onerror="this.onerror=null;this.src='../images/news/placeholder.jpg';"/></div>`;
      }

      article.innerHTML = `
        ${imgHtml}
        <p class="news-date">${dateText}</p>
        <h3>${title}</h3>
        <p>${excerpt}</p>
      `;

      grid.appendChild(article);
      observer.observe(article);
    });
  } catch (err) {
    // silent
  }
}

// Enable simple drag-to-scroll gallery and arrow controls for history photos
function enableHistoryGallery() {
  const gallery = document.getElementById("historyGallery");
  if (!gallery) return;
  gallery.classList.add("draggable");

  // Drag to scroll (mouse)
  let isDown = false;
  let startX = 0;
  let scrollLeft = 0;

  gallery.addEventListener("mousedown", (e) => {
    isDown = true;
    gallery.classList.add("active");
    startX = e.pageX - gallery.offsetLeft;
    scrollLeft = gallery.scrollLeft;
    e.preventDefault();
  });
  gallery.addEventListener("mouseleave", () => {
    isDown = false;
    gallery.classList.remove("active");
  });
  gallery.addEventListener("mouseup", () => {
    isDown = false;
    gallery.classList.remove("active");
  });
  gallery.addEventListener("mousemove", (e) => {
    if (!isDown) return;
    const x = e.pageX - gallery.offsetLeft;
    const walk = (x - startX) * 1; // multiplier
    gallery.scrollLeft = scrollLeft - walk;
  });

  // Touch support
  let touchStartX = 0;
  let touchScrollLeft = 0;
  gallery.addEventListener("touchstart", (e) => {
    touchStartX = e.touches[0].pageX - gallery.offsetLeft;
    touchScrollLeft = gallery.scrollLeft;
  });
  gallery.addEventListener("touchmove", (e) => {
    const x = e.touches[0].pageX - gallery.offsetLeft;
    const walk = (x - touchStartX) * 1;
    gallery.scrollLeft = touchScrollLeft - walk;
  });

  // Prev/Next buttons
  const prev = document.querySelector(".gallery-prev");
  const next = document.querySelector(".gallery-next");
  const scrollAmount = Math.round(gallery.clientWidth * 0.8);
  prev?.addEventListener("click", () => {
    gallery.scrollBy({ left: -scrollAmount, behavior: "smooth" });
  });
  next?.addEventListener("click", () => {
    gallery.scrollBy({ left: scrollAmount, behavior: "smooth" });
  });
}
