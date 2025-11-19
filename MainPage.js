// MainPage.js
// Calendar application with Firebase authentication, task management, and category filtering

import { auth, db } from "./src/firebaseAPIConfig.js";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
} from "firebase/firestore";

// ============================================
// State Variables
// ============================================

let currentUser = null;
let tasks = [];
let currentWeekOffset = 0;
let weekDates = [];

// Category filter state (all enabled by default)
let categoryFilters = {
  study: true,
  work: true,
  exercise: true,
  group: true,
};

// Drag system variables
let isDragging = false;
let draggedTask = null;
let draggedElement = null;
let dragClone = null;
let startX = 0;
let startY = 0;
let currentX = 0;
let currentY = 0;

// Firestore real-time listener
let unsubscribe = null;

// ============================================
// Date Helper Functions
// ============================================

/**
 * Get the Monday of the week for a given date
 * @param {Date} d - The date to find Monday for
 * @returns {Date} - Monday of that week
 */
function getMonday(d) {
  d = new Date(d);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

/**
 * Format date as YYYY-MM-DD
 * @param {Date} date - Date to format
 * @returns {string} - Formatted date string
 */
function formatDate(date) {
  return date.toISOString().split("T")[0];
}

// ============================================
// Calendar Functions
// ============================================

/**
 * Update the week display header with dates
 */
function updateWeekDisplay() {
  const today = new Date();
  const monday = getMonday(today);
  monday.setDate(monday.getDate() + currentWeekOffset * 7);

  weekDates = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(monday);
    date.setDate(date.getDate() + i);
    weekDates.push(formatDate(date));
  }

  // Update day headers with dates
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  weekDates.forEach((date, i) => {
    const dayEl = document.getElementById(`day${i}`);

    const [year, month, day] = date.split("-").map(Number);
    const dateObj = new Date(year, month - 1, day);

    dayEl.innerHTML = `${
      dayNames[i]
    }<br><span style="font-size: 12px; font-weight: normal;">${dateObj.getDate()}/${
      dateObj.getMonth() + 1
    }</span>`;
  });

  // Update week range display
  const [year1, month1, day1] = weekDates[0].split("-").map(Number);
  const [year2, month2, day2] = weekDates[6].split("-").map(Number);
  const firstDate = new Date(year1, month1 - 1, day1);
  const lastDate = new Date(year2, month2 - 1, day2);

  document.getElementById(
    "weekDisplay"
  ).textContent = `${firstDate.getDate()} ${firstDate.toLocaleString("en", {
    month: "short",
  })} - ${lastDate.getDate()} ${lastDate.toLocaleString("en", {
    month: "short",
  })} ${lastDate.getFullYear()}`;
}

/**
 * Change the displayed week
 * @param {number} offset - Number of weeks to move (-1 for previous, +1 for next)
 */
function changeWeek(offset) {
  currentWeekOffset += offset;
  updateWeekDisplay();
  renderTasks();
}

/**
 * Initialize the calendar grid (24 hours x 7 days)
 */
function initCalendar() {
  const calendarBody = document.getElementById("calendarBody");

  for (let hour = 0; hour < 24; hour++) {
    const row = document.createElement("div");
    row.className = "calendar-row";

    // Time label column
    const timeCell = document.createElement("div");
    timeCell.className = "time-cell";
    timeCell.textContent = `${hour.toString().padStart(2, "0")}:00`;
    row.appendChild(timeCell);

    // Create 7 day cells
    for (let day = 0; day < 7; day++) {
      const dayCell = document.createElement("div");
      dayCell.className = "day-cell";
      dayCell.dataset.dayIndex = day;
      dayCell.dataset.hour = hour;
      row.appendChild(dayCell);
    }

    calendarBody.appendChild(row);
  }

  updateWeekDisplay();
}

// ============================================
// Category Filter Functions
// ============================================

/**
 * Check if a task should be visible based on category filters
 * @param {string} category - Task category
 * @returns {boolean} - Whether task should be visible
 */
function shouldShowTask(category) {
  return categoryFilters[category] === true;
}

/**
 * Update category filter state and re-render tasks
 * @param {string} category - Category to toggle
 * @param {boolean} isChecked - New checked state
 */
function updateCategoryFilter(category, isChecked) {
  categoryFilters[category] = isChecked;
  renderTasks();
}

// ============================================
// Drag and Drop System
// ============================================

/**
 * Handle mouse/touch down event - start of drag
 */
function handleMouseDown(e, task, taskElement) {
  // Don't drag if clicking delete button
  if (e.target.classList.contains("task-delete")) {
    return;
  }

  isDragging = false;
  draggedTask = task;
  draggedElement = taskElement;

  // Get position from mouse or touch
  const clientX = e.type === "touchstart" ? e.touches[0].clientX : e.clientX;
  const clientY = e.type === "touchstart" ? e.touches[0].clientY : e.clientY;

  startX = clientX;
  startY = clientY;
  currentX = clientX;
  currentY = clientY;

  // Add appropriate event listeners
  if (e.type === "touchstart") {
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchend", handleTouchEnd);
    document.addEventListener("touchcancel", handleTouchEnd);
  } else {
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }

  // Prevent scrolling while dragging
  const scheduleBox = document.querySelector(".schedule-box");
  if (scheduleBox) {
    scheduleBox.style.overflow = "hidden";
  }

  e.preventDefault();
  e.stopPropagation();
}

/**
 * Handle mouse move during drag
 */
function handleMouseMove(e) {
  if (!draggedTask) return;

  currentX = e.clientX;
  currentY = e.clientY;
  handleDragMove(currentX, currentY);
  e.preventDefault();
}

/**
 * Handle touch move during drag
 */
function handleTouchMove(e) {
  if (!draggedTask) return;

  currentX = e.touches[0].clientX;
  currentY = e.touches[0].clientY;
  handleDragMove(currentX, currentY);
  e.preventDefault();
}

/**
 * Common drag move logic for both mouse and touch
 */
function handleDragMove(x, y) {
  const deltaX = Math.abs(x - startX);
  const deltaY = Math.abs(y - startY);

  // Start dragging after 3px movement threshold
  if (!isDragging && (deltaX > 3 || deltaY > 3)) {
    isDragging = true;

    // Create visual clone of task
    dragClone = draggedElement.cloneNode(true);
    dragClone.style.position = "fixed";
    dragClone.style.pointerEvents = "none";
    dragClone.style.opacity = "0.8";
    dragClone.style.zIndex = "10000";
    dragClone.style.width = draggedElement.offsetWidth + "px";
    dragClone.style.cursor = "grabbing";
    dragClone.style.transform = "scale(1.05)";
    document.body.appendChild(dragClone);

    // Fade out original element
    draggedElement.style.opacity = "0.3";
  }

  if (isDragging && dragClone) {
    // Move clone to follow cursor
    dragClone.style.left = x - draggedElement.offsetWidth / 2 + "px";
    dragClone.style.top = y - 20 + "px";

    // Find cell under cursor
    const elements = document.elementsFromPoint(x, y);

    // Remove all highlights
    document.querySelectorAll(".day-cell").forEach((cell) => {
      cell.classList.remove("drag-over");
    });

    // Highlight cell under cursor
    const dayCell = elements.find((el) => el.classList.contains("day-cell"));
    if (dayCell) {
      dayCell.classList.add("drag-over");
    }
  }
}

/**
 * Handle mouse up - end of drag
 */
async function handleMouseUp(e) {
  document.removeEventListener("mousemove", handleMouseMove);
  document.removeEventListener("mouseup", handleMouseUp);
  await finishDrag();
}

/**
 * Handle touch end - end of drag
 */
async function handleTouchEnd(e) {
  document.removeEventListener("touchmove", handleTouchMove);
  document.removeEventListener("touchend", handleTouchEnd);
  await finishDrag();
}

/**
 * Finish drag operation and update Firestore
 */
async function finishDrag() {
  // Re-enable scrolling
  const scheduleBox = document.querySelector(".schedule-box");
  if (scheduleBox) {
    scheduleBox.style.overflow = "auto";
  }

  if (isDragging && draggedTask && currentUser) {
    // Find which cell task was dropped on
    const elements = document.elementsFromPoint(currentX, currentY);
    const dayCell = elements.find((el) => el.classList.contains("day-cell"));

    if (dayCell) {
      const dayIndex = parseInt(dayCell.dataset.dayIndex);
      const hour = parseInt(dayCell.dataset.hour);

      const newDate = weekDates[dayIndex];
      const newTime = `${hour.toString().padStart(2, "0")}:00`;

      // Update in Firestore if date/time changed
      if (draggedTask.date !== newDate || draggedTask.time !== newTime) {
        try {
          const taskRef = doc(db, "tasks", draggedTask.firestoreId);
          await updateDoc(taskRef, {
            date: newDate,
            time: newTime,
          });
        } catch (error) {
          console.error("Error updating task:", error);
          alert("Failed to update task");
        }
      }
    }
  }

  // Cleanup
  if (dragClone) {
    dragClone.remove();
    dragClone = null;
  }

  if (draggedElement) {
    draggedElement.style.opacity = "1";
  }

  document.querySelectorAll(".day-cell").forEach((cell) => {
    cell.classList.remove("drag-over");
  });

  isDragging = false;
  draggedTask = null;
  draggedElement = null;
}

// ============================================
// Modal Functions
// ============================================

function openModal() {
  document.getElementById("taskModal").style.display = "block";
}

function closeModal() {
  document.getElementById("taskModal").style.display = "none";
  document.getElementById("taskForm").reset();
}

// ============================================
// Task Management Functions
// ============================================

/**
 * Render all tasks on the calendar
 */
function renderTasks() {
  // Remove all existing task elements
  document.querySelectorAll(".task-item").forEach((item) => item.remove());

  tasks.forEach((task) => {
    const dayIndex = weekDates.indexOf(task.date);

    if (dayIndex !== -1) {
      const hour = parseInt(task.time.split(":")[0]);

      const cell = document.querySelector(
        `.day-cell[data-day-index="${dayIndex}"][data-hour="${hour}"]`
      );

      if (cell) {
        const taskItem = document.createElement("div");
        taskItem.className = "task-item";
        taskItem.dataset.category = task.category || "study"; // Default to study if no category

        // Apply visibility based on category filter
        if (!shouldShowTask(task.category || "study")) {
          taskItem.classList.add("hidden");
        }

        taskItem.innerHTML = `
          <div class="task-name">${task.name}</div>
          <div class="task-time">${task.time}</div>
          <button class="task-delete">×</button>
        `;

        // Add drag event listeners (both mouse and touch)
        taskItem.addEventListener("mousedown", (e) => {
          handleMouseDown(e, task, taskItem);
        });

        taskItem.addEventListener(
          "touchstart",
          (e) => {
            handleMouseDown(e, task, taskItem);
          },
          { passive: false }
        );

        // Delete button handler
        taskItem
          .querySelector(".task-delete")
          .addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (confirm(`Delete task "${task.name}"?`)) {
              deleteTask(task.firestoreId);
            }
          });

        cell.appendChild(taskItem);
      }
    }
  });
}

/**
 * Delete a task from Firestore
 * @param {string} firestoreId - Document ID in Firestore
 */
async function deleteTask(firestoreId) {
  if (!currentUser) return;

  try {
    await deleteDoc(doc(db, "tasks", firestoreId));
  } catch (error) {
    console.error("Error deleting task:", error);
    alert("Failed to delete task");
  }
}

/**
 * Load tasks from Firestore with real-time updates
 */
function loadTasks() {
  if (!currentUser) return;

  // Unsubscribe from previous listener if exists
  if (unsubscribe) {
    unsubscribe();
  }

  // Create real-time listener for user's tasks
  const q = query(
    collection(db, "tasks"),
    where("userId", "==", currentUser.uid)
  );

  unsubscribe = onSnapshot(
    q,
    (querySnapshot) => {
      tasks = [];
      querySnapshot.forEach((docSnap) => {
        tasks.push({
          firestoreId: docSnap.id,
          ...docSnap.data(),
        });
      });
      renderTasks();
    },
    (error) => {
      console.error("Error loading tasks:", error);
    }
  );
}

// ============================================
// Authentication Functions
// ============================================

/**
 * Log out the current user and redirect to login
 */
async function handleLogout() {
  try {
    await signOut(auth);
    console.log("User logged out successfully");
    window.location.href = "/Login.html";
  } catch (error) {
    console.error("Error logging out:", error);
    alert("Failed to logout. Please try again.");
  }
}

// ============================================
// Event Listeners Setup
// ============================================

document.addEventListener("DOMContentLoaded", function () {
  initCalendar();

  // Check authentication state
  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentUser = user;
      console.log("User logged in:", user.email);
      loadTasks();
    } else {
      currentUser = null;
      tasks = [];
      renderTasks();
      console.log("No user logged in");
    }
  });

  // Hamburger menu toggle
  const burgerBtn = document.getElementById("burger-btn");
  const dropdownMenu = document.getElementById("dropdown-menu");

  burgerBtn.addEventListener("click", () => {
    dropdownMenu.classList.toggle("show");
  });

  // Close menu when clicking outside
  window.addEventListener("click", (e) => {
    if (!burgerBtn.contains(e.target) && !dropdownMenu.contains(e.target)) {
      dropdownMenu.classList.remove("show");
    }
  });

  // Category filter checkboxes
  document.querySelectorAll(".category-filter").forEach((checkbox) => {
    checkbox.addEventListener("change", (e) => {
      const category = e.target.dataset.category;
      const isChecked = e.target.checked;
      updateCategoryFilter(category, isChecked);
    });
  });

  // Logout button
  document.getElementById("logout-btn").addEventListener("click", async () => {
    dropdownMenu.classList.remove("show");
    await handleLogout();
  });

  // Week navigation
  document
    .getElementById("prevWeek")
    .addEventListener("click", () => changeWeek(-1));
  document
    .getElementById("nextWeek")
    .addEventListener("click", () => changeWeek(1));

  // Add task button
  document.getElementById("addBtn").addEventListener("click", openModal);

  // Cancel button
  document.getElementById("cancelBtn").addEventListener("click", closeModal);

  // Task form submission
  document
    .getElementById("taskForm")
    .addEventListener("submit", async function (e) {
      e.preventDefault();

      if (!currentUser) {
        alert("Please login first");
        return;
      }

      const taskName = document.getElementById("taskName").value;
      const taskCategory = document.getElementById("taskCategory").value;
      const taskDate = document.getElementById("taskDate").value;
      const taskTime = document.getElementById("taskTime").value;

      try {
        await addDoc(collection(db, "tasks"), {
          userId: currentUser.uid,
          name: taskName,
          category: taskCategory,
          date: taskDate,
          time: taskTime,
          createdAt: new Date(),
        });

        closeModal();
      } catch (error) {
        console.error("Error adding task:", error);
        alert("Failed to add task");
      }
    });

  // Close modal when clicking outside
  window.addEventListener("click", function (event) {
    const taskModal = document.getElementById("taskModal");
    if (event.target === taskModal) {
      closeModal();
    }
  });
});

// Reminder Part

const switchButtons = document.querySelectorAll(".reminder-switch button");
const switchPill = document.querySelector(".switch-pill");

switchButtons.forEach((btn, index) => {
  btn.addEventListener("click", () => {
    // update active button
    switchButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    // move pill
    if (index === 0) {
      // Personal
      switchPill.classList.remove("right");
      switchPill.classList.add("left");
    } else {
      // Group
      switchPill.classList.remove("left");
      switchPill.classList.add("right");
    }

    // later you can use this to change content
    const type = btn.dataset.type; // "group" or "personal"
    console.log("Current reminder type:", type);
  });
});
