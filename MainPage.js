// MainPage.js

// Import Firebase from your existing config
import { auth, db } from "./src/firebaseAPIConfig.js";
import { onAuthStateChanged } from "firebase/auth";
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

// Current user
let currentUser = null;

// Task management
let tasks = [];
let currentWeekOffset = 0;
let weekDates = [];

// Manuel Drag sistemi
let isDragging = false;
let draggedTask = null;
let draggedElement = null;
let dragClone = null;
let startX = 0;
let startY = 0;
let currentX = 0;
let currentY = 0;

// Firestore listener
let unsubscribe = null;

// Get Monday of the week for a given date
function getMonday(d) {
  d = new Date(d);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

// Format date as YYYY-MM-DD
function formatDate(date) {
  return date.toISOString().split("T")[0];
}

// Update week display and dates
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

  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  weekDates.forEach((date, i) => {
    const dayEl = document.getElementById(`day${i}`);
    const dateObj = new Date(date);
    dayEl.innerHTML = `${
      dayNames[i]
    }<br><span style="font-size: 12px; font-weight: normal;">${dateObj.getDate()}/${
      dateObj.getMonth() + 1
    }</span>`;
  });

  const firstDate = new Date(weekDates[0]);
  const lastDate = new Date(weekDates[6]);
  document.getElementById(
    "weekDisplay"
  ).textContent = `${firstDate.getDate()} ${firstDate.toLocaleString("en", {
    month: "short",
  })} - ${lastDate.getDate()} ${lastDate.toLocaleString("en", {
    month: "short",
  })} ${lastDate.getFullYear()}`;
}

function changeWeek(offset) {
  currentWeekOffset += offset;
  updateWeekDisplay();
  renderTasks();
}

// Initialize calendar
function initCalendar() {
  const calendarBody = document.getElementById("calendarBody");

  for (let hour = 0; hour < 24; hour++) {
    const row = document.createElement("div");
    row.className = "calendar-row";

    const timeCell = document.createElement("div");
    timeCell.className = "time-cell";
    timeCell.textContent = `${hour.toString().padStart(2, "0")}:00`;
    row.appendChild(timeCell);

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

// MANUAL DRAG SYSTEM - Both mouse and touch support
function handleMouseDown(e, task, taskElement) {
  // Don't handle if delete button is clicked
  if (e.target.classList.contains("task-delete")) {
    return;
  }

  console.log(`📌 ${e.type} - Task: ${task.name}`);

  isDragging = false;
  draggedTask = task;
  draggedElement = taskElement;

  // Get mouse or touch position
  const clientX = e.type === "touchstart" ? e.touches[0].clientX : e.clientX;
  const clientY = e.type === "touchstart" ? e.touches[0].clientY : e.clientY;

  startX = clientX;
  startY = clientY;
  currentX = clientX;
  currentY = clientY;

  // Add event listeners (both mouse and touch)
  if (e.type === "touchstart") {
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchend", handleTouchEnd);
    document.addEventListener("touchcancel", handleTouchEnd);
  } else {
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }

  // Prevent scrolling
  const scheduleBox = document.querySelector(".schedule-box");
  if (scheduleBox) {
    scheduleBox.style.overflow = "hidden";
  }

  e.preventDefault();
  e.stopPropagation();
}

function handleMouseMove(e) {
  if (!draggedTask) return;

  currentX = e.clientX;
  currentY = e.clientY;

  handleDragMove(currentX, currentY);

  e.preventDefault();
}

function handleTouchMove(e) {
  if (!draggedTask) return;

  currentX = e.touches[0].clientX;
  currentY = e.touches[0].clientY;

  handleDragMove(currentX, currentY);

  e.preventDefault();
}

function handleDragMove(x, y) {
  const deltaX = Math.abs(x - startX);
  const deltaY = Math.abs(y - startY);

  // Start dragging after 3 pixels of movement
  if (!isDragging && (deltaX > 3 || deltaY > 3)) {
    isDragging = true;
    console.log("🎯 Dragging started!");

    // Create clone
    dragClone = draggedElement.cloneNode(true);
    dragClone.style.position = "fixed";
    dragClone.style.pointerEvents = "none";
    dragClone.style.opacity = "0.8";
    dragClone.style.zIndex = "10000";
    dragClone.style.width = draggedElement.offsetWidth + "px";
    dragClone.style.cursor = "grabbing";
    dragClone.style.transform = "scale(1.05)";
    document.body.appendChild(dragClone);

    // Hide original element
    draggedElement.style.opacity = "0.3";
  }

  if (isDragging && dragClone) {
    // Move clone
    dragClone.style.left = x - draggedElement.offsetWidth / 2 + "px";
    dragClone.style.top = y - 20 + "px";

    // Find which cell we're over
    const elements = document.elementsFromPoint(x, y);

    // Remove previous highlights
    document.querySelectorAll(".day-cell").forEach((cell) => {
      cell.classList.remove("drag-over");
    });

    // Highlight new cell
    const dayCell = elements.find((el) => el.classList.contains("day-cell"));
    if (dayCell) {
      dayCell.classList.add("drag-over");
    }
  }
}

async function handleMouseUp(e) {
  console.log("🔴 Mouse up");

  // Event listenerları temizle
  document.removeEventListener("mousemove", handleMouseMove);
  document.removeEventListener("mouseup", handleMouseUp);

  await finishDrag();
}

async function handleTouchEnd(e) {
  console.log("🔴 Touch end");

  // Event listenerları temizle
  document.removeEventListener("touchmove", handleTouchMove);
  document.removeEventListener("touchend", handleTouchEnd);

  await finishDrag();
}

async function finishDrag() {
  // Re-enable scrolling
  const scheduleBox = document.querySelector(".schedule-box");
  if (scheduleBox) {
    scheduleBox.style.overflow = "auto";
  }

  if (isDragging && draggedTask && currentUser) {
    // Which cell was it dropped on?
    const elements = document.elementsFromPoint(currentX, currentY);
    const dayCell = elements.find((el) => el.classList.contains("day-cell"));

    if (dayCell) {
      const dayIndex = parseInt(dayCell.dataset.dayIndex);
      const hour = parseInt(dayCell.dataset.hour);

      const newDate = weekDates[dayIndex];
      const newTime = `${hour.toString().padStart(2, "0")}:00`;

      console.log(`✅ Task dropped: ${newDate} ${newTime}`);

      // Update in Firestore
      if (draggedTask.date !== newDate || draggedTask.time !== newTime) {
        try {
          const taskRef = doc(db, "tasks", draggedTask.firestoreId);
          await updateDoc(taskRef, {
            date: newDate,
            time: newTime,
          });
          console.log("💾 Firebase updated!");
        } catch (error) {
          console.error("❌ Firebase error:", error);
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

  // Remove highlights
  document.querySelectorAll(".day-cell").forEach((cell) => {
    cell.classList.remove("drag-over");
  });

  isDragging = false;
  draggedTask = null;
  draggedElement = null;
}

function openModal() {
  document.getElementById("taskModal").style.display = "block";
}

function closeModal() {
  document.getElementById("taskModal").style.display = "none";
  document.getElementById("taskForm").reset();
}

function renderTasks() {
  // Remove all existing tasks
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

        taskItem.innerHTML = `
          <div class="task-name">${task.name}</div>
          <div class="task-time">${task.time}</div>
          <button class="task-delete">×</button>
        `;

        // MANUAL DRAG - Mouse and Touch events
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

        // Delete handler
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

async function deleteTask(firestoreId) {
  if (!currentUser) return;

  try {
    await deleteDoc(doc(db, "tasks", firestoreId));
    console.log("Task deleted successfully");
  } catch (error) {
    console.error("Error deleting task:", error);
    alert("Failed to delete task");
  }
}

// Load tasks from Firestore
function loadTasks() {
  if (!currentUser) return;

  // Unsubscribe from previous listener
  if (unsubscribe) {
    unsubscribe();
  }

  // Create real-time listener
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

// Event Listeners
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

  // Task form
  document
    .getElementById("taskForm")
    .addEventListener("submit", async function (e) {
      e.preventDefault();

      if (!currentUser) {
        alert("Please login first");
        return;
      }

      const taskName = document.getElementById("taskName").value;
      const taskDate = document.getElementById("taskDate").value;
      const taskTime = document.getElementById("taskTime").value;

      try {
        await addDoc(collection(db, "tasks"), {
          userId: currentUser.uid,
          name: taskName,
          date: taskDate,
          time: taskTime,
          createdAt: new Date(),
        });

        closeModal();
        console.log("Task added successfully");
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
