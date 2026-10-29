
"use strict";

/*
 * TerraViva — Simulador IoT
 * Todos os valores gerados são SIMULADOS.
 * Nenhum sensor físico é consultado ou conectado.
 */

const CONFIG = {
  defaultInterval: 10,
  maxChartPoints: 24,
  defaultPeriod: 12,
  humidity: { min: 0, max: 100 },
  temperature: { min: 15, max: 35 },
  chartAnimationDuration: 850
};

const scenarios = {
  normal: {
    title: "Operação normal",
    icon: "🌿",
    description:
      "Oscilações moderadas de umidade e temperatura para representar condições estáveis.",
    humidity: { min: 38, max: 60, step: 3 },
    temperature: { min: 21, max: 28, step: 0.7 }
  },
  seca: {
    title: "Estresse hídrico (seca)",
    icon: "☀️",
    description:
      "A umidade tende a diminuir a cada leitura, simulando um período sem irrigação.",
    humidity: { min: 8, max: 34, step: 4 },
    temperature: { min: 24, max: 33, step: 0.9 }
  },
  calor: {
    title: "Temperatura elevada (calor)",
    icon: "🔥",
    description:
      "A temperatura tende a subir, enquanto a umidade pode oscilar ou diminuir.",
    humidity: { min: 22, max: 48, step: 3 },
    temperature: { min: 30, max: 35, step: 0.8 }
  }
};

const demoData = {
  humidity: {
    values: [
      35, 38, 36, 43, 40, 45, 42, 39, 44, 42, 46, 42,
      41, 43, 40, 44, 42, 45, 43, 41, 44, 42, 46, 42
    ],
    unit: "%",
    label: "Umidade (%)",
    title: "Umidade do solo",
    color: "#a7d96c",
    min: 0,
    max: 100
  },
  temperature: {
    values: [
      21.8, 22.1, 22.5, 22.8, 23.2, 23.7,
      24.1, 23.9, 24.4, 24.8, 24.5, 24.2,
      24.7, 25.0, 24.6, 24.3, 24.8, 25.2,
      24.9, 24.6, 24.2, 24.7, 24.5, 24.5
    ],
    unit: "°C",
    label: "Temperatura (°C)",
    title: "Temperatura ambiente",
    color: "#f0b56b",
    min: 15,
    max: 35
  }
};

/* -------------------------------------------------------
   ESTADO GLOBAL
------------------------------------------------------- */

let soilChart = null;
let chartMetric = null;
let selectedMetric = "humidity";
let selectedPeriod = CONFIG.defaultPeriod;

let simulatorState = "stopped";
let simulatorTimer = null;
let toastTimeout = null;
let elapsedTimer = null;
let audioContext = null;

let readingCount = 0;
let sessionStartTime = null;
let elapsedBeforePause = 0;

let lastHumidity = 42;
let lastTemperature = 24.5;

let liveSamples = {
  humidity: [],
  temperature: []
};

// Controle independente da animação visual do gráfico.
let pulseFrameId = null;
let pulseAnimationActive = false;

// Evita repetir o mesmo alerta a cada leitura.
let lastAlertKey = null;

/* -------------------------------------------------------
   UTILITÁRIOS
------------------------------------------------------- */

function getElement(id) {
  return document.getElementById(id);
}

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatTime(date = new Date()) {
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatElapsed(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return [
      String(hours).padStart(2, "0"),
      String(minutes).padStart(2, "0"),
      String(seconds).padStart(2, "0")
    ].join(":");
  }

  return [
    String(minutes).padStart(2, "0"),
    String(seconds).padStart(2, "0")
  ].join(":");
}

function getIntervalMilliseconds() {
  const selected = Number(getElement("intervalSelect")?.value);
  const seconds = Number.isFinite(selected) && selected > 0
    ? selected
    : CONFIG.defaultInterval;

  return seconds * 1000;
}

function getScenario() {
  const selected = getElement("scenarioSelect")?.value || "normal";
  return scenarios[selected] ? selected : "normal";
}

/* -------------------------------------------------------
   NOTIFICAÇÕES TOAST
------------------------------------------------------- */

function showToast(message, type = "success") {
  const toast = getElement("toast");
  const toastMessage = getElement("toastMessage");
  const toastIcon = getElement("toastIcon");

  if (!toast || !toastMessage || !toastIcon) {
    console.log("[TerraViva]", message);
    return;
  }

  clearTimeout(toastTimeout);

  toastMessage.textContent = message;
  toast.classList.remove(
    "toast-warning",
    "toast-error",
    "visible"
  );

  if (type === "warning") {
    toast.classList.add("toast-warning");
    toastIcon.textContent = "!";
  } else if (type === "error") {
    toast.classList.add("toast-error");
    toastIcon.textContent = "×";
  } else {
    toastIcon.textContent = "✓";
  }

  requestAnimationFrame(() => {
    toast.classList.add("visible");
  });

  toastTimeout = setTimeout(() => {
    toast.classList.remove("visible");
  }, 3500);
}

function hideToast() {
  clearTimeout(toastTimeout);
  getElement("toast")?.classList.remove("visible");
}

/* -------------------------------------------------------
   EFEITOS SONOROS
------------------------------------------------------- */

function soundsEnabled() {
  return Boolean(getElement("soundToggle")?.checked);
}

async function initializeAudio() {
  if (!soundsEnabled()) return false;

  const AudioContextClass =
    window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    showToast(
      "Este navegador não oferece suporte a áudio sintetizado.",
      "warning"
    );
    return false;
  }

  try {
    if (!audioContext) {
      audioContext = new AudioContextClass();
    }

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    return audioContext.state === "running";
  } catch (error) {
    console.warn("Não foi possível iniciar o áudio:", error);
    return false;
  }
}

function playTone(frequency = 660, duration = 0.09, volume = 0.035) {
  if (
    !soundsEnabled() ||
    !audioContext ||
    audioContext.state !== "running"
  ) {
    return;
  }

  try {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const startAt = audioContext.currentTime;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, startAt);

    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(
      volume,
      startAt + 0.012
    );
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      startAt + duration
    );

    oscillator.connect(gain);
    gain.connect(audioContext.destination);

    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.02);
  } catch (error) {
    console.warn("Falha ao reproduzir efeito sonoro:", error);
  }
}

function playSound(type) {
  if (!soundsEnabled()) return;

  const sounds = {
    start: [[560, 0.08], [760, 0.12]],
    reading: [[660, 0.065]],
    pause: [[440, 0.12]],
    stop: [[520, 0.08], [350, 0.13]],
    warning: [[360, 0.12], [300, 0.15]]
  };

  const sequence = sounds[type] || sounds.reading;

  sequence.forEach(([frequency, duration], index) => {
    setTimeout(() => {
      playTone(frequency, duration);
    }, index * 100);
  });
}

/* -------------------------------------------------------
   GERAÇÃO DE LEITURAS SIMULADAS
------------------------------------------------------- */

function generateReading() {
  const scenarioName = getScenario();
  const scenario = scenarios[scenarioName];

  let humidity;
  let temperature;

  if (scenarioName === "normal") {
    humidity = lastHumidity + randomBetween(
      -scenario.humidity.step,
      scenario.humidity.step
    );

    temperature = lastTemperature + randomBetween(
      -scenario.temperature.step,
      scenario.temperature.step
    );

    // Retorno gradual à faixa normal.
    humidity += (randomBetween(43, 53) - humidity) * 0.12;
    temperature += (randomBetween(22, 27) - temperature) * 0.12;
  } else if (scenarioName === "seca") {
    humidity = lastHumidity - randomBetween(
      0.5,
      scenario.humidity.step
    );

    temperature = lastTemperature + randomBetween(
      -0.2,
      scenario.temperature.step
    );

    humidity = clamp(
      humidity,
      scenario.humidity.min,
      scenario.humidity.max
    );

    temperature = clamp(
      temperature,
      scenario.temperature.min,
      scenario.temperature.max
    );
  } else {
    temperature = lastTemperature + randomBetween(
      0.1,
      scenario.temperature.step
    );

    humidity = lastHumidity + randomBetween(
      -scenario.humidity.step,
      0.4
    );

    temperature = clamp(
      temperature,
      scenario.temperature.min,
      scenario.temperature.max
    );

    humidity = clamp(
      humidity,
      scenario.humidity.min,
      scenario.humidity.max
    );
  }

  humidity = Number(clamp(humidity, 0, 100).toFixed(1));
  temperature = Number(clamp(temperature, 15, 35).toFixed(1));

  lastHumidity = humidity;
  lastTemperature = temperature;

  const timestamp = new Date();

  liveSamples.humidity.push({
    label: formatTime(timestamp),
    value: humidity,
    timestamp: timestamp.getTime()
  });

  liveSamples.temperature.push({
    label: formatTime(timestamp),
    value: temperature,
    timestamp: timestamp.getTime()
  });

  Object.keys(liveSamples).forEach((metric) => {
    while (
      liveSamples[metric].length > CONFIG.maxChartPoints
    ) {
      liveSamples[metric].shift();
    }
  });

  readingCount += 1;

  updateMetricCards();
  updateChart();
  updateReadingCount();
  updateLastUpdate(timestamp);
  updateEnvironmentalStatus();

  // Efeito visual nos cartões de indicadores.
  const metricCard = getElement("humidityValue")
    ?.closest(".metric-card");

  const tempCard = getElement("temperatureValue")
    ?.closest(".metric-card");

  [metricCard, tempCard].forEach((card) => {
    if (!card) return;

    card.classList.remove("value-updated");
    void card.offsetWidth;
    card.classList.add("value-updated");
  });

  return {
    humidity,
    temperature,
    timestamp,
    scenario: scenarioName
  };
}

function updateScenarioDescription() {
  const scenario = scenarios[getScenario()];
  const description = getElement("scenarioDescription");

  if (!description) return;

  description.innerHTML = `
    <span class="scenario-icon">${scenario.icon}</span>
    <div>
      <strong>${scenario.title}</strong>
      <p>${scenario.description}</p>
    </div>
  `;
}

/* -------------------------------------------------------
   INDICADORES DO DASHBOARD
------------------------------------------------------- */

function updateMetricCards() {
  const humidityValue = getElement("humidityValue");
  const temperatureValue = getElement("temperatureValue");
  const humidityProgress = getElement("humidityProgress");
  const temperatureProgress = getElement("temperatureProgress");

  if (humidityValue) {
    humidityValue.textContent = lastHumidity.toFixed(1).replace(".0", "");
  }

  if (temperatureValue) {
    temperatureValue.textContent = lastTemperature.toFixed(1);
  }

  if (humidityProgress) {
    humidityProgress.style.width =
      `${clamp(lastHumidity, 0, 100)}%`;
  }

  if (temperatureProgress) {
    const percentage = ((lastTemperature - 15) / 20) * 100;

    temperatureProgress.style.width =
      `${clamp(percentage, 0, 100)}%`;
  }

  const humidityStatus = getElement("humidityStatus");
  const temperatureStatus = getElement("temperatureStatus");

  if (humidityStatus) {
    if (lastHumidity < 25) {
      humidityStatus.textContent = "Umidade baixa (simulada)";
    } else if (lastHumidity > 70) {
      humidityStatus.textContent = "Umidade elevada (simulada)";
    } else {
      humidityStatus.textContent = "Faixa demonstrativa";
    }
  }

  if (temperatureStatus) {
    if (lastTemperature >= 32) {
      temperatureStatus.textContent = "Calor elevado (simulado)";
    } else if (lastTemperature <= 18) {
      temperatureStatus.textContent = "Temperatura baixa (simulado)";
    } else {
      temperatureStatus.textContent = "Faixa moderada";
    }
  }
}

function updateReadingCount() {
  const count = getElement("readingCount");

  if (count) {
    count.textContent = String(readingCount);
  }
}

function updateLastUpdate(date) {
  const lastUpdate = getElement("lastUpdate");

  if (lastUpdate) {
    lastUpdate.textContent =
      `Última leitura: ${formatTime(date)}`;
  }
}

function updateEnvironmentalStatus() {
  const scenarioName = getScenario();
  const message = getElement("sessionMessage");

  const isDry = scenarioName === "seca" && lastHumidity < 25;
  const isHot = scenarioName === "calor" && lastTemperature >= 32;

  if (message) {
    if (isDry) {
      message.textContent = "Alerta demonstrativo: umidade baixa";
    } else if (isHot) {
      message.textContent = "Alerta demonstrativo: temperatura elevada";
    } else {
      message.textContent = "Leitura simulada processada";
    }
  }

  const indicator = getElement("sensorStatusIndicator");

  if (indicator) {
    indicator.classList.toggle(
      "indicator-warning",
      isDry || isHot
    );
  }
}

/* -------------------------------------------------------
   GRÁFICO — HISTÓRICO E DADOS RECENTES
------------------------------------------------------- */

function makeHistoricalLabels(count) {
  const now = new Date();

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(
      now.getTime() - (count - index - 1) * 60 * 60 * 1000
    );

    return date.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit"
    });
  });
}

function getVisibleData(metric, period) {
  const config = demoData[metric];
  const live = liveSamples[metric];

  if (live.length > 0) {
    const points = live.slice(-period);

    return {
      labels: points.map((point) => point.label),
      values: points.map((point) => point.value),
      isLive: true
    };
  }

  const values = config.values.slice(-period);

  return {
    labels: makeHistoricalLabels(values.length),
    values,
    isLive: false
  };
}

function updateChartText() {
  const config = demoData[selectedMetric];
  const live = liveSamples[selectedMetric].length > 0;

  const title = getElement("chartTitle");
  const description = getElement("chartDescription");
  const legend = getElement("chartLegendLabel");
  const legendDot = getElement("chartLegendDot");
  const periodSummary = getElement("periodSummary");

  if (title) {
    title.textContent = config.title;
  }

  if (legend) {
    legend.textContent = config.label;
  }

  if (legendDot) {
    legendDot.style.backgroundColor = config.color;
  }

  if (description) {
    description.textContent = live
      ? "Leituras geradas pelo simulador nesta sessão. Não são provenientes de sensores físicos."
      : "Histórico inicial demonstrativo. Inicie a simulação para visualizar novas leituras.";
  }

  if (periodSummary) {
    periodSummary.textContent =
      `Últimas ${selectedPeriod} leituras`;
  }
}

/*
 * Plugin visual:
 * desenha um ponto luminoso pulsante na extremidade
 * da curva enquanto a simulação está em execução.
 */
const livePulsePlugin = {
  id: "terraVivaLivePulse",

  afterDatasetsDraw(chart) {
    if (simulatorState !== "running") return;
    if (!chart.data.datasets.length) return;

    const meta = chart.getDatasetMeta(0);

    if (!meta || !meta.data || meta.data.length === 0) {
      return;
    }

    const point = meta.data[meta.data.length - 1];

    if (!point || typeof point.getProps !== "function") {
      return;
    }

    const position = point.getProps(["x", "y"], true);

    if (
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y)
    ) {
      return;
    }

    const ctx = chart.ctx;
    const now = performance.now();

    // Pulso entre aproximadamente 4 e 8 pixels.
    const pulse = (Math.sin(now / 230) + 1) / 2;
    const radius = 4 + pulse * 3;
    const color = demoData[chartMetric]?.color || "#a7d96c";

    ctx.save();

    // Halo externo.
    ctx.beginPath();
    ctx.arc(position.x, position.y, radius + 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.10 + pulse * 0.12;
    ctx.fill();

    // Núcleo luminoso.
    ctx.globalAlpha = 1;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12 + pulse * 12;

    ctx.beginPath();
    ctx.arc(position.x, position.y, radius * 0.65, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Centro branco para reforçar o efeito de sensor ativo.
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(position.x, position.y, 1.8, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();

    ctx.restore();
  }
};

/* -------------------------------------------------------
   ANIMAÇÃO CONTÍNUA DO INDICADOR
------------------------------------------------------- */

function animateChartPulse() {
  if (
    !pulseAnimationActive ||
    simulatorState !== "running" ||
    !soilChart
  ) {
    pulseFrameId = null;
    return;
  }

  // Redesenha apenas o efeito visual, sem gerar leituras.
  soilChart.draw();

  pulseFrameId = requestAnimationFrame(animateChartPulse);
}

function startChartPulse() {
  if (pulseAnimationActive) return;

  pulseAnimationActive = true;

  if (pulseFrameId !== null) {
    cancelAnimationFrame(pulseFrameId);
  }

  pulseFrameId = requestAnimationFrame(animateChartPulse);
}

function stopChartPulse() {
  pulseAnimationActive = false;

  if (pulseFrameId !== null) {
    cancelAnimationFrame(pulseFrameId);
    pulseFrameId = null;
  }

  // Remove o indicador pulsante imediatamente ao pausar.
  if (soilChart) {
    soilChart.draw();
  }
}

/* -------------------------------------------------------
   CRIAÇÃO E ATUALIZAÇÃO DO GRÁFICO
------------------------------------------------------- */

function createSoilChart() {
  const canvas = getElement("soilChart");
  const fallback = getElement("chartFallback");

  if (!canvas || typeof Chart === "undefined") {
    if (fallback) fallback.hidden = false;

    if (typeof Chart === "undefined") {
      console.warn(
        "Chart.js não foi encontrado. Verifique a inclusão da biblioteca no HTML."
      );
    }

    return;
  }

  if (fallback) {
    fallback.hidden = true;
  }

  const context = canvas.getContext("2d");
  const config = demoData[selectedMetric];
  const visible = getVisibleData(selectedMetric, selectedPeriod);

  // Só destrói o gráfico quando realmente precisa recriá-lo.
  if (soilChart) {
    soilChart.destroy();
    soilChart = null;
  }

  const gradient = context.createLinearGradient(0, 0, 0, 260);

  gradient.addColorStop(
    0,
    selectedMetric === "humidity"
      ? "rgba(167, 217, 108, 0.23)"
      : "rgba(240, 181, 107, 0.23)"
  );

  gradient.addColorStop(1, "rgba(18, 30, 20, 0.01)");

  soilChart = new Chart(context, {
    type: "line",

    data: {
      labels: visible.labels,

      datasets: [{
        label: config.label,
        data: visible.values,

        borderColor: config.color,
        backgroundColor: gradient,

        borderWidth: 2.5,
        fill: true,
        tension: 0.38,

        pointRadius: visible.values.length > 16 ? 2 : 3,
        pointHoverRadius: 5,
        pointBackgroundColor: config.color,
        pointBorderColor: "#132016",
        pointBorderWidth: 1.5,

        // Mantém o traçado com aspecto suave.
        borderCapStyle: "round",
        borderJoinStyle: "round"
      }]
    },

    plugins: [livePulsePlugin],

    options: {
      responsive: true,
      maintainAspectRatio: false,

      animation: {
        duration: CONFIG.chartAnimationDuration,
        easing: "easeInOutSine"
      },

      interaction: {
        intersect: false,
        mode: "index"
      },

      plugins: {
        legend: {
          display: false
        },

        tooltip: {
          backgroundColor: "#17251a",
          titleColor: "#eaf4e5",
          bodyColor: "#bfd2b8",
          borderColor: "rgba(167, 217, 108, 0.25)",
          borderWidth: 1,
          padding: 11,
          displayColors: false,

          callbacks: {
            label(context) {
              const value = Number(context.parsed.y).toFixed(1);

              return `${config.label}: ${value}${config.unit === "%" ? "%" : " °C"}`;
            },

            afterBody() {
              return ["Dado simulado"];
            }
          }
        }
      },

      scales: {
        x: {
          grid: {
            color: "rgba(180, 215, 173, 0.055)",
            drawTicks: false
          },

          border: {
            display: false
          },

          ticks: {
            color: "#8fa18b",
            maxTicksLimit: 8,
            maxRotation: 0,
            autoSkip: true,
            font: {
              size: 10
            }
          }
        },

        y: {
          min: config.min,
          max: config.max,

          grid: {
            color: "rgba(180, 215, 173, 0.075)",
            drawTicks: false
          },

          border: {
            display: false
          },

          ticks: {
            color: "#8fa18b",
            padding: 9,
            font: {
              size: 10
            },

            callback(value) {
              return `${value}${config.unit}`;
            }
          }
        }
      }
    }
  });

  chartMetric = selectedMetric;

  updateChartText();
}

function updateChart() {
  const canvas = getElement("soilChart");
  const fallback = getElement("chartFallback");

  if (!canvas || typeof Chart === "undefined") {
    if (fallback) fallback.hidden = false;
    return;
  }

  if (fallback) {
    fallback.hidden = true;
  }

  // Cria o gráfico se ainda não existir ou se a métrica mudou.
  if (!soilChart || chartMetric !== selectedMetric) {
    createSoilChart();

    if (simulatorState === "running") {
      startChartPulse();
    }

    return;
  }

  const config = demoData[selectedMetric];
  const visible = getVisibleData(selectedMetric, selectedPeriod);
  const dataset = soilChart.data.datasets[0];

  // Atualiza os dados do gráfico existente.
  // Não destrói nem recria o gráfico a cada leitura.
  soilChart.data.labels = visible.labels;
  dataset.data = visible.values;
  dataset.label = config.label;
  dataset.borderColor = config.color;
  dataset.pointBackgroundColor = config.color;
  dataset.pointRadius = visible.values.length > 16 ? 2 : 3;

  soilChart.options.scales.y.min = config.min;
  soilChart.options.scales.y.max = config.max;

  soilChart.options.scales.y.ticks.callback = (value) =>
    `${value}${config.unit}`;

  // Anima a transição entre as posições antigas e novas.
  soilChart.update();

  updateChartText();
}

/* -------------------------------------------------------
   ESTADO DO SIMULADOR
------------------------------------------------------- */

function updateSimulatorState(state) {
  simulatorState = state;

  const stateElement = getElement("simulatorState");
  const stateText = getElement("simulatorStateText");
  const metricStatus = getElement("simulatorMetricStatus");
  const sensorStatus = getElement("sensorStatus");
  const startButton = getElement("startButton");
  const pauseButton = getElement("pauseButton");
  const stopButton = getElement("stopButton");
  const sensorIndicator = getElement("sensorStatusIndicator");

  if (stateElement) {
    stateElement.classList.remove(
      "state-running",
      "state-paused",
      "state-stopped"
    );

    stateElement.classList.add(`state-${state}`);
  }

  const stateLabels = {
    running: "Em execução",
    paused: "Pausado",
    stopped: "Parado"
  };

  if (stateText) {
    stateText.textContent = stateLabels[state];
  }

  if (metricStatus) {
    metricStatus.textContent =
      state === "running"
        ? "Ativo"
        : state === "paused"
          ? "Pausado"
          : "Parado";
  }

  if (sensorStatus) {
    sensorStatus.textContent =
      state === "running"
        ? "Simulação em execução"
        : state === "paused"
          ? "Simulação pausada"
          : "Pronto para simulação";
  }

  if (startButton) {
    startButton.disabled = state === "running";

    startButton.innerHTML =
      state === "paused"
        ? "<span>▶</span> Retomar"
        : "<span>▶</span> Iniciar";
  }

  if (pauseButton) {
    pauseButton.disabled = state !== "running";
  }

  if (stopButton) {
    stopButton.disabled = state === "stopped";
  }

  if (sensorIndicator) {
    sensorIndicator.classList.toggle(
      "indicator-running",
      state === "running"
    );
  }

  const intervalSummary = getElement("intervalSummary");

  if (intervalSummary) {
    intervalSummary.textContent =
      `${getIntervalMilliseconds() / 1000} s`;
  }
}

function stopSimulationTimer() {
  if (simulatorTimer !== null) {
    clearInterval(simulatorTimer);
    simulatorTimer = null;
  }
}

/* -------------------------------------------------------
   CICLO DE LEITURA E ALERTAS
------------------------------------------------------- */

function runSimulationCycle() {
  const reading = generateReading();

  playSound("reading");

  let alertKey = null;
  let alertMessage = "";

  if (
    reading.scenario === "seca" &&
    reading.humidity < 25
  ) {
    alertKey = "seca";
    alertMessage =
      `Alerta simulado: umidade do solo em ${reading.humidity}%.`;
  } else if (
    reading.scenario === "calor" &&
    reading.temperature >= 32
  ) {
    alertKey = "calor";
    alertMessage =
      `Alerta simulado: temperatura em ${reading.temperature} °C.`;
  }

  // Notifica apenas quando uma condição de alerta começa
  // ou quando muda de um tipo de alerta para outro.
  if (alertKey && alertKey !== lastAlertKey) {
    showToast(alertMessage, "warning");
    playSound("warning");
  }

  lastAlertKey = alertKey;
}

async function startSimulation() {
  if (simulatorState === "running") return;

  await initializeAudio();

  // Retomada da sessão pausada.
  if (simulatorState === "paused") {
    sessionStartTime = Date.now();

    updateSimulatorState("running");
    startElapsedTimer();
    startSimulationTimer();
    startChartPulse();

    playSound("start");
    showToast("Simulação retomada.", "success");

    return;
  }

  // Inicialização de uma nova sessão.
  readingCount = 0;
  liveSamples = {
    humidity: [],
    temperature: []
  };

  elapsedBeforePause = 0;
  sessionStartTime = Date.now();
  lastAlertKey = null;

  updateReadingCount();
  updateElapsedDisplay();
  updateSimulatorState("running");

  // Primeira leitura imediata.
  runSimulationCycle();

  startElapsedTimer();
  startSimulationTimer();
  startChartPulse();

  playSound("start");

  showToast(
    `Simulação iniciada: ${scenarios[getScenario()].title}.`,
    "success"
  );
}

function startSimulationTimer() {
  stopSimulationTimer();

  simulatorTimer = setInterval(() => {
    if (simulatorState === "running") {
      runSimulationCycle();
    }
  }, getIntervalMilliseconds());
}

function pauseSimulation() {
  if (simulatorState !== "running") return;

  stopSimulationTimer();
  stopElapsedTimer();
  stopChartPulse();

  if (sessionStartTime !== null) {
    elapsedBeforePause += Date.now() - sessionStartTime;
    sessionStartTime = null;
  }

  updateSimulatorState("paused");

  playSound("pause");

  showToast(
    "Simulação pausada. Os dados foram preservados.",
    "warning"
  );
}

function stopSimulation() {
  if (simulatorState === "stopped") return;

  stopSimulationTimer();
  stopElapsedTimer();
  stopChartPulse();

  if (sessionStartTime !== null) {
    elapsedBeforePause += Date.now() - sessionStartTime;
    sessionStartTime = null;
  }

  updateSimulatorState("stopped");

  playSound("stop");

  const sessionMessage = getElement("sessionMessage");

  if (sessionMessage) {
    sessionMessage.textContent = "Sessão encerrada manualmente";
  }

  showToast(
    "Simulação parada. As leituras desta sessão continuam no painel.",
    "warning"
  );
}

/* -------------------------------------------------------
   CRONÔMETRO DA SESSÃO
------------------------------------------------------- */

function startElapsedTimer() {
  stopElapsedTimer();
  updateElapsedDisplay();

  elapsedTimer = setInterval(updateElapsedDisplay, 1000);
}

function stopElapsedTimer() {
  if (elapsedTimer !== null) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

function updateElapsedDisplay() {
  let elapsed = elapsedBeforePause;

  if (
    simulatorState === "running" &&
    sessionStartTime !== null
  ) {
    elapsed += Date.now() - sessionStartTime;
  }

  const elapsedElement = getElement("elapsedTime");

  if (elapsedElement) {
    elapsedElement.textContent = formatElapsed(elapsed);
  }
}

/* -------------------------------------------------------
   LEITURA MANUAL
------------------------------------------------------- */

async function refreshDemo() {
  await initializeAudio();

  generateReading();
  playSound("reading");

  const button = getElement("refreshButton");

  if (button) {
    button.classList.remove("is-refreshing");
    void button.offsetWidth;
    button.classList.add("is-refreshing");
  }

  showToast(
    "Nova leitura simulada gerada. Nenhum sensor físico foi consultado.",
    "success"
  );
}

/* -------------------------------------------------------
   NAVEGAÇÃO
------------------------------------------------------- */

function setupNavigation() {
  const menuToggle = getElement("menuToggle");
  const sidebar = getElement("sidebar");

  menuToggle?.addEventListener("click", () => {
    const isOpen = sidebar?.classList.toggle("open") || false;

    menuToggle.setAttribute("aria-expanded", String(isOpen));
    menuToggle.setAttribute(
      "aria-label",
      isOpen ? "Fechar menu" : "Abrir menu"
    );
  });

  document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", () => {
      document.querySelectorAll(".nav-link").forEach((item) => {
        item.classList.remove("active");
      });

      link.classList.add("active");
      sidebar?.classList.remove("open");
      menuToggle?.setAttribute("aria-expanded", "false");
    });
  });

  document.addEventListener("click", (event) => {
    if (
      window.innerWidth <= 800 &&
      sidebar &&
      menuToggle &&
      sidebar.classList.contains("open") &&
      !sidebar.contains(event.target) &&
      !menuToggle.contains(event.target)
    ) {
      sidebar.classList.remove("open");
      menuToggle.setAttribute("aria-expanded", "false");
    }
  });
}

/* -------------------------------------------------------
   CONTROLES DO GRÁFICO
------------------------------------------------------- */

function setupChartControls() {
  const metricSelect = getElement("metricSelect");

  metricSelect?.addEventListener("change", () => {
    selectedMetric =
      metricSelect.value === "temperature"
        ? "temperature"
        : "humidity";

    updateChart();

    if (simulatorState === "running") {
      startChartPulse();
    }
  });

  document.querySelectorAll(".period-button").forEach((button) => {
    button.addEventListener("click", () => {
      const requestedPeriod = Number(button.dataset.period);

      selectedPeriod = Number.isFinite(requestedPeriod) &&
        requestedPeriod > 0
          ? requestedPeriod
          : CONFIG.defaultPeriod;

      document.querySelectorAll(".period-button").forEach((item) => {
        item.classList.toggle("active", item === button);
      });

      updateChart();
    });
  });

  getElement("refreshButton")?.addEventListener("click", refreshDemo);
}

/* -------------------------------------------------------
   CONTROLES DO SIMULADOR
------------------------------------------------------- */

function setupSimulatorControls() {
  getElement("startButton")?.addEventListener(
    "click",
    startSimulation
  );

  getElement("pauseButton")?.addEventListener(
    "click",
    pauseSimulation
  );

  getElement("stopButton")?.addEventListener(
    "click",
    stopSimulation
  );

  getElement("scenarioSelect")?.addEventListener("change", () => {
    updateScenarioDescription();

    // Permite que um novo cenário gere seus próprios alertas.
    lastAlertKey = null;

    showToast(
      `Cenário selecionado: ${scenarios[getScenario()].title}.`,
      "success"
    );
  });

  getElement("intervalSelect")?.addEventListener("change", () => {
    const intervalSummary = getElement("intervalSummary");

    if (intervalSummary) {
      intervalSummary.textContent =
        `${getIntervalMilliseconds() / 1000} s`;
    }

    // Aplica imediatamente o novo intervalo.
    if (simulatorState === "running") {
      startSimulationTimer();
    }

    showToast(
      `Intervalo configurado para ${getIntervalMilliseconds() / 1000} segundos.`,
      "success"
    );
  });

  getElement("soundToggle")?.addEventListener(
    "change",
    async (event) => {
      const enabled = event.target.checked;
      const soundLabel = getElement("soundLabel");

      if (soundLabel) {
        soundLabel.textContent =
          enabled ? "Ativados" : "Desativados";
      }

      if (enabled) {
        await initializeAudio();
        playTone(660, 0.1);

        showToast("Efeitos sonoros ativados.", "success");
      } else {
        showToast("Efeitos sonoros desativados.", "warning");
      }
    }
  );

  getElement("toastClose")?.addEventListener("click", hideToast);
}

/* -------------------------------------------------------
   INICIALIZAÇÃO
------------------------------------------------------- */

function initializeDashboard() {
  updateScenarioDescription();
  updateMetricCards();
  updateReadingCount();
  updateElapsedDisplay();
  updateSimulatorState("stopped");
  updateEnvironmentalStatus();

  createSoilChart();

  setupNavigation();
  setupChartControls();
  setupSimulatorControls();

  const physicalSensorStatus = getElement("physicalSensorStatus");

  if (physicalSensorStatus) {
    physicalSensorStatus.textContent = "Não conectados";
  }

  console.info(
    "TerraViva iniciado. Todos os dados são simulados; sensores físicos não estão conectados."
  );
}

document.addEventListener(
  "DOMContentLoaded",
  initializeDashboard
);
