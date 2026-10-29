"use strict";

// TerraViva — dashboard acadêmico.
// ATENÇÃO: todos os valores são simulados e não representam medições reais.

const demoData = {
  humidity: {
    values: [35, 38, 36, 43, 40, 45, 42, 39, 44, 42, 46, 42, 41, 43, 40, 44, 42, 45, 43, 41, 44, 42, 46, 42],
    unit: "%",
    label: "Umidade (%)",
    title: "Umidade do solo",
    color: "#a7d96c",
    min: 0,
    max: 100
  },
  temperature: {
    values: [21.8, 22.1, 22.5, 22.8, 23.2, 23.7, 24.1, 23.9, 24.4, 24.8, 24.5, 24.2, 24.7, 25.0, 24.6, 24.3, 24.8, 25.2, 24.9, 24.6, 24.2, 24.7, 24.5, 24.5],
    unit: "°C",
    label: "Temperatura (°C)",
    title: "Temperatura",
    color: "#f0b56b",
    min: 15,
    max: 35
  }
};

let soilChart = null;
let selectedMetric = "humidity";
let selectedPeriod = 12;
let toastTimeout = null;

function makeLabels(count) {
  const labels = [];
  const startHour = 24 - count;
  for (let i = 0; i < count; i++) {
    const hour = ((startHour + i) % 24 + 24) % 24;
    labels.push(String(hour).padStart(2, "0") + "h");
  }
  return labels;
}

function getVisibleData(metric, period) {
  const source = demoData[metric];
  const count = Math.min(period, source.values.length);
  return {
    labels: makeLabels(count),
    values: source.values.slice(-count)
  };
}

function createSoilChart() {
  const canvas = document.getElementById("soilChart");
  if (!canvas || typeof Chart === "undefined") return;

  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0, selectedMetric === "humidity" ? "rgba(167, 217, 108, 0.22)" : "rgba(240, 181, 107, 0.22)");
  gradient.addColorStop(1, "rgba(20, 30, 22, 0)");

  const visible = getVisibleData(selectedMetric, selectedPeriod);
  const metric = demoData[selectedMetric];

  if (soilChart) soilChart.destroy();

  soilChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: visible.labels,
      datasets: [{
        label: metric.label,
        data: visible.values,
        borderColor: metric.color,
        backgroundColor: gradient,
        borderWidth: 2.5,
        fill: true,
        tension: 0.38,
        pointRadius: 2.5,
        pointHoverRadius: 5,
        pointBackgroundColor: metric.color,
        pointBorderColor: "#19231b",
        pointBorderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#101812",
          titleColor: "#edf4ec",
          bodyColor: "#c4d0c2",
          borderColor: "#344334",
          borderWidth: 1,
          padding: 12,
          displayColors: false,
          callbacks: {
            label: (context) => `${metric.title}: ${Number(context.parsed.y).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}${metric.unit}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: "#899889", maxTicksLimit: selectedPeriod === 24 ? 8 : 7, font: { family: "DM Sans", size: 11 } }
        },
        y: {
          min: metric.min,
          max: metric.max,
          border: { display: false, dash: [4, 4] },
          grid: { color: "rgba(145, 160, 147, 0.12)" },
          ticks: {
            color: "#899889",
            padding: 10,
            font: { family: "DM Sans", size: 11 },
            callback: (value) => `${value}${metric.unit}`
          }
        }
      }
    }
  });

  document.getElementById("chartTitle").textContent = metric.title;
  document.getElementById("chartLegendLabel").textContent = metric.label;
  document.getElementById("chartDescription").textContent = "Variação simulada ao longo do período selecionado.";
  document.getElementById("periodSummary").textContent = `Últimas ${selectedPeriod} horas`;
}

function updateMetricCards() {
  const humidity = demoData.humidity.values[demoData.humidity.values.length - 1];
  const temperature = demoData.temperature.values[demoData.temperature.values.length - 1];
  document.getElementById("humidityValue").textContent = humidity.toLocaleString("pt-BR");
  document.getElementById("temperatureValue").textContent = temperature.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  document.getElementById("humidityProgress").style.width = `${humidity}%`;
  document.getElementById("temperatureProgress").style.width = `${Math.min(100, Math.max(0, (temperature / 50) * 100))}%`;
}

function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("visible");
  if (toastTimeout) window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove("visible"), 3200);
}

function refreshDemo() {
  // Pequena variação fictícia para demonstrar interação; não consulta sensores.
  const humidity = demoData.humidity.values;
  const temperature = demoData.temperature.values;
  const lastHumidity = humidity[humidity.length - 1];
  const lastTemperature = temperature[temperature.length - 1];
  humidity.push(Math.max(30, Math.min(60, lastHumidity + (Math.random() > 0.5 ? 1 : -1) * (Math.random() > 0.55 ? 2 : 1))));
  temperature.push(Math.max(20, Math.min(28, Number((lastTemperature + (Math.random() > 0.5 ? 0.3 : -0.3)).toFixed(1)))));
  humidity.shift();
  temperature.shift();
  updateMetricCards();
  createSoilChart();
  showToast("Demonstração atualizada. Nenhum sensor físico foi consultado.");
}

function setupNavigation() {
  const links = document.querySelectorAll(".nav-link");
  links.forEach((link) => {
    link.addEventListener("click", () => {
      links.forEach((item) => item.classList.remove("active"));
      link.classList.add("active");
      closeMobileMenu();
    });
  });
}

function closeMobileMenu() {
  const sidebar = document.getElementById("sidebar");
  const button = document.getElementById("mobileMenuButton");
  sidebar.classList.remove("sidebar-open");
  button.setAttribute("aria-expanded", "false");
}

function setupMobileMenu() {
  const button = document.getElementById("mobileMenuButton");
  button.addEventListener("click", () => {
    const sidebar = document.getElementById("sidebar");
    const isOpen = sidebar.classList.toggle("sidebar-open");
    button.setAttribute("aria-expanded", String(isOpen));
    button.setAttribute("aria-label", isOpen ? "Fechar menu" : "Abrir menu");
  });
}

function setupChartControls() {
  document.getElementById("metricSelect").addEventListener("change", (event) => {
    selectedMetric = event.target.value;
    createSoilChart();
  });

  document.querySelectorAll(".period-button").forEach((button) => {
    button.addEventListener("click", () => {
      selectedPeriod = Number(button.dataset.period);
      document.querySelectorAll(".period-button").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      createSoilChart();
    });
  });

  document.getElementById("refreshButton").addEventListener("click", refreshDemo);
}

function initializeDashboard() {
  updateMetricCards();
  createSoilChart();
  setupChartControls();
  setupNavigation();
  setupMobileMenu();
}

document.addEventListener("DOMContentLoaded", initializeDashboard);
