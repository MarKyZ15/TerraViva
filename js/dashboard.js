
"use strict";

/*
 * TerraViva — Simulador IoT
 *
 * IMPORTANTE:
 * - Todos os dados são simulados.
 * - Nenhum sensor físico é consultado ou conectado.
 *
 * Recursos:
 * - Onda contínua com movimento fluido.
 * - Leituras simuladas a cada 1 segundo.
 * - Interpolação entre leituras.
 * - Um único ciclo de animação.
 * - Pausa e retomada com preservação do progresso.
 * - Alertas, sons, histórico e cronômetro.
 * - Chart.js atualizado sem animações concorrentes.
 */

const CONFIG = {
  defaultInterval: 1,
  readingInterval: 1000,
  frameInterval: 1000 / 30,
  maxChartPoints: 24,
  defaultPeriod: 12,

  humidity: { min: 0, max: 100 },
  temperature: { min: 15, max: 35 },

  // Ondulação visual: amplitude em unidades de cada métrica.
  wave: {
    humidityAmplitude: 1.25,
    humiditySecondaryAmplitude: 0.4,
    temperatureAmplitude: 0.18,
    temperatureSecondaryAmplitude: 0.07,
    frequency: 0.48,
    secondaryFrequency: 0.23,
    speed: 2.0,
    secondarySpeed: 1.25
  }
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

// Próxima leitura simulada e progresso da interpolação.
let pendingReading = null;
let animationStartedAt = 0;
let animationDuration = CONFIG.readingInterval;
let animationPausedProgress = 0;

// Único ciclo de animação visual.
let pulseFrameId = null;
let pulseAnimationActive = false;
let lastAnimationFrameAt = 0;
let animationElapsedBeforePause = 0;

// Tempo de referência para a onda.
let waveStartedAt = 0;

// Evita repetir alertas.
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

/*
 * A leitura é fixa em 1 segundo.
 * O seletor visual de intervalo não pode criar um segundo
 * ciclo ou alterar a frequência das leituras.
 */
function getIntervalMilliseconds() {
  return CONFIG.readingInterval;
}

function getScenario() {
  const selected = getElement("scenarioSelect")?.value || "normal";
  return scenarios[selected] ? selected : "normal";
}

function getMetricBounds(metric) {
  const config = demoData[metric] || demoData.humidity;

  return {
    min: config.min,
    max: config.max
  };
}

/* -------------------------------------------------------
   TOASTS
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
   ÁUDIO
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
   CÁLCULO DAS LEITURAS SIMULADAS
------------------------------------------------------- */

function calculateReading(
  baseHumidity = lastHumidity,
  baseTemperature = lastTemperature,
  scenarioName = getScenario()
) {
  const scenario = scenarios[scenarioName];

  let humidity;
  let temperature;

  if (scenarioName === "normal") {
    humidity = baseHumidity + randomBetween(
      -scenario.humidity.step,
      scenario.humidity.step
    );

    temperature = baseTemperature + randomBetween(
      -scenario.temperature.step,
      scenario.temperature.step
    );

    humidity += (randomBetween(43, 53) - humidity) * 0.12;
    temperature += (randomBetween(22, 27) - temperature) * 0.12;
  } else if (scenarioName === "seca") {
    humidity = baseHumidity - randomBetween(
      0.5,
      scenario.humidity.step
    );

    temperature = baseTemperature + randomBetween(
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
    temperature = baseTemperature + randomBetween(
      0.1,
      scenario.temperature.step
    );

    humidity = baseHumidity + randomBetween(
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

  return {
    humidity: Number(clamp(humidity, 0, 100).toFixed(1)),
    temperature: Number(clamp(temperature, 15, 35).toFixed(1)),
    timestamp: new Date(),
    scenario: scenarioName
  };
}

function commitReading(reading) {
  lastHumidity = reading.humidity;
  lastTemperature = reading.temperature;

  const timestamp = reading.timestamp instanceof Date
    ? reading.timestamp
    : new Date(reading.timestamp);

  reading.timestamp = timestamp;

  liveSamples.humidity.push({
    label: formatTime(timestamp),
    value: reading.humidity,
    timestamp: timestamp.getTime()
  });

  liveSamples.temperature.push({
    label: formatTime(timestamp),
    value: reading.temperature,
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

  const humidityCard = getElement("humidityValue")
    ?.closest(".metric-card");

  const temperatureCard = getElement("temperatureValue")
    ?.closest(".metric-card");

  [humidityCard, temperatureCard].forEach((card) => {
    if (!card) return;

    card.classList.remove("value-updated");
    void card.offsetWidth;
    card.classList.add("value-updated");
  });

  return reading;
}

function generateReading() {
  const reading = commitReading(calculateReading());

  if (simulatorState === "running") {
    prepareNextReading();
    startSimulationTimer();
  } else {
    pendingReading = null;
    animationPausedProgress = 0;
    updateChart();
  }

  return reading;
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
   INDICADORES
------------------------------------------------------- */

function updateMetricCards() {
  const humidityValue = getElement("humidityValue");
  const temperatureValue = getElement("temperatureValue");
  const humidityProgress = getElement("humidityProgress");
  const temperatureProgress = getElement("temperatureProgress");

  if (humidityValue) {
    humidityValue.textContent =
      lastHumidity.toFixed(1).replace(".0", "");
  }

  if (temperatureValue) {
    temperatureValue.textContent = lastTemperature.toFixed(1);
  }

  if (humidityProgress) {
    humidityProgress.style.width =
      `${clamp(lastHumidity, 0, 100)}%`;
  }

  if (temperatureProgress) {
    temperatureProgress.style.width =
      `${clamp(((lastTemperature - 15) / 20) * 100, 0, 100)}%`;
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
    lastUpdate.textContent = `Última leitura: ${formatTime(date)}`;
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
      message.textContent =
        "Alerta demonstrativo: temperatura elevada";
    } else {
      message.textContent = "Leitura simulada processada";
    }
  }

  getElement("sensorStatusIndicator")?.classList.toggle(
    "indicator-warning",
    isDry || isHot
  );
}

/* -------------------------------------------------------
   INTERPOLAÇÃO
------------------------------------------------------- */

function smoothStep(progress) {
  const p = clamp(progress, 0, 1);
  return p * p * (3 - 2 * p);
}

function getAnimationProgress() {
  if (!pendingReading || animationDuration <= 0) {
    return 0;
  }

  if (simulatorState === "paused") {
    return clamp(animationPausedProgress, 0, 1);
  }

  if (simulatorState !== "running") {
    return 0;
  }

  return clamp(
    (performance.now() - animationStartedAt) / animationDuration,
    0,
    1
  );
}

function getInterpolatedReading() {
  if (!pendingReading) return null;

  const progress = smoothStep(getAnimationProgress());

  return {
    humidity: lastHumidity
      + (pendingReading.humidity - lastHumidity) * progress,

    temperature: lastTemperature
      + (pendingReading.temperature - lastTemperature) * progress,

    progress
  };
}

function prepareNextReading() {
  pendingReading = calculateReading();

  // Cada destino visual dura exatamente um segundo.
  animationDuration = CONFIG.readingInterval;
  animationStartedAt = performance.now();
  animationPausedProgress = 0;

  updateChart();
}

/* -------------------------------------------------------
   DADOS VISÍVEIS
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

  const hasAnimatedPoint = Boolean(
    pendingReading &&
    (simulatorState === "running" || simulatorState === "paused")
  );

  if (live.length > 0) {
    const liveLimit = hasAnimatedPoint
      ? Math.max(0, period - 1)
      : period;

    const points = liveLimit > 0
      ? live.slice(-liveLimit)
      : [];

    const labels = points.map((point) => point.label);
    const values = points.map((point) => point.value);

    if (hasAnimatedPoint) {
      const interpolated = getInterpolatedReading();

      if (interpolated) {
        labels.push("AGORA");
        values.push(interpolated[metric]);
      }
    }

    return {
      labels,
      values,
      isLive: true,
      isAnimating: hasAnimatedPoint
    };
  }

  const values = config.values.slice(-period);

  return {
    labels: makeHistoricalLabels(values.length),
    values,
    isLive: false,
    isAnimating: false
  };
}

function updateChartText() {
  const config = demoData[selectedMetric];
  const hasLiveData = liveSamples[selectedMetric].length > 0;

  const title = getElement("chartTitle");
  const description = getElement("chartDescription");
  const legend = getElement("chartLegendLabel");
  const legendDot = getElement("chartLegendDot");
  const periodSummary = getElement("periodSummary");

  if (title) title.textContent = config.title;
  if (legend) legend.textContent = config.label;

  if (legendDot) {
    legendDot.style.backgroundColor = config.color;
  }

  if (description) {
    description.textContent = hasLiveData
      ? "Leituras simuladas atualizadas a cada segundo. Não são provenientes de sensores físicos."
      : "Histórico inicial demonstrativo. Inicie a simulação para visualizar novas leituras.";
  }

  if (periodSummary) {
    periodSummary.textContent = `Últimos ${selectedPeriod} pontos`;
  }
}

/* -------------------------------------------------------
   PLUGIN: PONTO LUMINOSO
------------------------------------------------------- */

const livePulsePlugin = {
  id: "terraVivaLivePulse",

  afterDatasetsDraw(chart) {
    if (simulatorState !== "running") return;

    const meta = chart.getDatasetMeta(0);

    if (!meta?.data?.length) return;

    const point = meta.data[meta.data.length - 1];
    if (!point || typeof point.getProps !== "function") return;

    const position = point.getProps(["x", "y"], true);

    if (
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y)
    ) {
      return;
    }

    const ctx = chart.ctx;
    const pulse = (Math.sin(performance.now() / 230) + 1) / 2;
    const radius = 4 + pulse * 2.5;
    const color = demoData[chartMetric]?.color || "#a7d96c";

    ctx.save();

    ctx.beginPath();
    ctx.arc(position.x, position.y, radius + 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.1 + pulse * 0.12;
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10 + pulse * 10;

    ctx.beginPath();
    ctx.arc(position.x, position.y, radius * 0.65, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.arc(position.x, position.y, 1.8, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();

    ctx.restore();
  }
};

/* -------------------------------------------------------
   ONDA CONTÍNUA
------------------------------------------------------- */

/*
 * Calcula pequenas oscilações visuais sobre os dados.
 * A onda é apenas uma representação gráfica: não altera
 * as leituras confirmadas nem o contador de leituras.
 */
function getWaveValue(baseValue, index, elapsed, metric) {
  const settings = CONFIG.wave;

  const primaryAmplitude = metric === "temperature"
    ? settings.temperatureAmplitude
    : settings.humidityAmplitude;

  const secondaryAmplitude = metric === "temperature"
    ? settings.temperatureSecondaryAmplitude
    : settings.humiditySecondaryAmplitude;

  const primary = Math.sin(
    index * settings.frequency - elapsed * settings.speed
  ) * primaryAmplitude;

  const secondary = Math.sin(
    index * settings.secondaryFrequency
      - elapsed * settings.secondarySpeed
  ) * secondaryAmplitude;

  const bounds = getMetricBounds(metric);

  return Number(
    clamp(baseValue + primary + secondary, bounds.min, bounds.max)
      .toFixed(2)
  );
}

function animateChartPulse(timestamp) {
  if (
    !pulseAnimationActive ||
    simulatorState !== "running" ||
    !soilChart
  ) {
    pulseFrameId = null;
    return;
  }

  // Mantém apenas um requestAnimationFrame ativo.
  pulseFrameId = requestAnimationFrame(animateChartPulse);

  if (
    timestamp - lastAnimationFrameAt <
    CONFIG.frameInterval
  ) {
    return;
  }

  lastAnimationFrameAt = timestamp;

  const visible = getVisibleData(selectedMetric, selectedPeriod);

  if (!visible.values.length) return;

  /*
   * O tempo da onda usa performance.now(), que é monotônico.
   * Isso evita saltos provocados por alterações no relógio.
   */
  const elapsed = Math.max(
    0,
    (performance.now() - waveStartedAt) / 1000
  );

  const waveValues = visible.values.map((value, index) =>
    getWaveValue(value, index, elapsed, selectedMetric)
  );

  soilChart.data.labels = visible.labels;
  soilChart.data.datasets[0].data = waveValues;

  /*
   * update("none") recalcula os pontos do Chart.js sem
   * iniciar uma segunda animação interna concorrente.
   * O gráfico contém poucos pontos, portanto o custo é baixo.
   */
  soilChart.update("none");
}

function startChartPulse() {
  if (pulseAnimationActive || !soilChart) return;

  pulseAnimationActive = true;
  lastAnimationFrameAt = 0;

  if (!waveStartedAt) {
    waveStartedAt = performance.now();
  } else if (animationElapsedBeforePause > 0) {
    waveStartedAt = performance.now() - animationElapsedBeforePause;
  }

  pulseFrameId = requestAnimationFrame(animateChartPulse);
}

function stopChartPulse() {
  if (pulseFrameId !== null) {
    cancelAnimationFrame(pulseFrameId);
    pulseFrameId = null;
  }

  pulseAnimationActive = false;

  if (soilChart) {
    updateChart();
  }
}

/* -------------------------------------------------------
   CRIAÇÃO DO GRÁFICO
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

  if (fallback) fallback.hidden = true;

  const context = canvas.getContext("2d");
  const config = demoData[selectedMetric];
  const visible = getVisibleData(selectedMetric, selectedPeriod);

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

        // Curva suavizada.
        tension: 0.42,

        pointRadius: visible.values.length > 16 ? 1.5 : 2.5,
        pointHoverRadius: 5,
        pointBackgroundColor: config.color,
        pointBorderColor: "#132016",
        pointBorderWidth: 1.5,

        borderCapStyle: "round",
        borderJoinStyle: "round"
      }]
    },

    plugins: [livePulsePlugin],

    options: {
      responsive: true,
      maintainAspectRatio: false,

      // A animação é controlada pelo nosso único ciclo RAF.
      animation: false,

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

            afterBody(context) {
              if (context[0]?.label === "AGORA") {
                return [
                  "Onda visual em movimento",
                  "Valor interpolado e simulado"
                ];
              }

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

  if (fallback) fallback.hidden = true;

  if (!soilChart || chartMetric !== selectedMetric) {
    createSoilChart();
    return;
  }

  const config = demoData[selectedMetric];
  const visible = getVisibleData(selectedMetric, selectedPeriod);
  const dataset = soilChart.data.datasets[0];

  dataset.label = config.label;
  dataset.borderColor = config.color;
  dataset.pointBackgroundColor = config.color;
  dataset.pointRadius = visible.values.length > 16 ? 1.5 : 2.5;

  soilChart.data.labels = visible.labels;
  dataset.data = visible.values;

  soilChart.options.scales.y.min = config.min;
  soilChart.options.scales.y.max = config.max;

  soilChart.options.scales.y.ticks.callback = (value) =>
    `${value}${config.unit}`;

  soilChart.update("none");
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

  const labels = {
    running: "Em execução",
    paused: "Pausado",
    stopped: "Parado"
  };

  if (stateText) stateText.textContent = labels[state];

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
    intervalSummary.textContent = "1 s";
  }
}

/* -------------------------------------------------------
   TEMPORIZADOR DE LEITURAS
------------------------------------------------------- */

function stopSimulationTimer() {
  if (simulatorTimer !== null) {
    clearTimeout(simulatorTimer);
    simulatorTimer = null;
  }
}

function startSimulationTimer(delay = CONFIG.readingInterval) {
  stopSimulationTimer();

  if (simulatorState !== "running") return;

  simulatorTimer = setTimeout(() => {
    simulatorTimer = null;

    if (simulatorState === "running") {
      runSimulationCycle();
    }
  }, Math.max(0, delay));
}

/* -------------------------------------------------------
   ALERTAS
------------------------------------------------------- */

function processReadingAlerts(reading) {
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

  if (alertKey && alertKey !== lastAlertKey) {
    showToast(alertMessage, "warning");
    playSound("warning");
  }

  lastAlertKey = alertKey;
}

/* -------------------------------------------------------
   CICLO DE LEITURA
------------------------------------------------------- */

function runSimulationCycle() {
  if (simulatorState !== "running") return;

  // O destino visual é confirmado como uma leitura.
  const reading = pendingReading || calculateReading();

  pendingReading = null;
  animationPausedProgress = 0;

  commitReading(reading);
  processReadingAlerts(reading);
  playSound("reading");

  // Prepara a próxima onda e agenda uma leitura em 1 segundo.
  prepareNextReading();
  startSimulationTimer(CONFIG.readingInterval);
}

/* -------------------------------------------------------
   INICIAR / RETOMAR
------------------------------------------------------- */

async function startSimulation() {
  if (simulatorState === "running") return;

  await initializeAudio();

  if (simulatorState === "paused") {
    if (!pendingReading) {
      prepareNextReading();
    }

    animationStartedAt =
      performance.now() -
      animationPausedProgress * animationDuration;

    // Continua a contagem a partir do tempo acumulado.
    sessionStartTime = Date.now();

    updateSimulatorState("running");
    startElapsedTimer();
    startChartPulse();

    const remaining = Math.max(
      0,
      animationDuration * (1 - animationPausedProgress)
    );

    startSimulationTimer(remaining);

    playSound("start");
    showToast("Simulação retomada.", "success");
    return;
  }

  stopSimulationTimer();
  stopElapsedTimer();
  stopChartPulse();

  readingCount = 0;

  liveSamples = {
    humidity: [],
    temperature: []
  };

  pendingReading = null;
  animationPausedProgress = 0;
  elapsedBeforePause = 0;
  animationElapsedBeforePause = 0;
  waveStartedAt = performance.now();

  sessionStartTime = Date.now();
  lastAlertKey = null;

  updateReadingCount();
  updateElapsedDisplay();
  updateSimulatorState("running");

  // Registra uma leitura inicial imediatamente.
  const initialReading = commitReading(calculateReading());

  processReadingAlerts(initialReading);

  // O próximo ponto se move continuamente durante 1 segundo.
  prepareNextReading();

  startElapsedTimer();
  startChartPulse();
  startSimulationTimer(CONFIG.readingInterval);

  playSound("start");

  showToast(
    `Simulação iniciada: ${scenarios[getScenario()].title}. Leituras a cada 1 segundo.`,
    "success"
  );
}

/* -------------------------------------------------------
   PAUSAR
------------------------------------------------------- */

function pauseSimulation() {
  if (simulatorState !== "running") return;

  animationPausedProgress = pendingReading
    ? getAnimationProgress()
    : 0;

  animationElapsedBeforePause = waveStartedAt
    ? performance.now() - waveStartedAt
    : 0;

  stopSimulationTimer();
  stopElapsedTimer();
  stopChartPulse();

  if (sessionStartTime !== null) {
    elapsedBeforePause += Date.now() - sessionStartTime;
    sessionStartTime = null;
  }

  updateSimulatorState("paused");
  updateChart();

  playSound("pause");

  showToast(
    "Simulação pausada. Leituras e progresso visual preservados.",
    "warning"
  );
}

/* -------------------------------------------------------
   PARAR
------------------------------------------------------- */

function stopSimulation() {
  if (simulatorState === "stopped") return;

  stopSimulationTimer();
  stopElapsedTimer();
  stopChartPulse();

  if (sessionStartTime !== null) {
    elapsedBeforePause += Date.now() - sessionStartTime;
    sessionStartTime = null;
  }

  pendingReading = null;
  animationPausedProgress = 0;
  animationElapsedBeforePause = 0;
  waveStartedAt = 0;

  updateSimulatorState("stopped");
  updateChart();

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
   CRONÔMETRO
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

    // A animação existente continua usando a métrica escolhida.
    if (simulatorState === "running" && !pulseAnimationActive) {
      startChartPulse();
    }
  });

  document.querySelectorAll(".period-button").forEach((button) => {
    button.addEventListener("click", () => {
      const requestedPeriod = Number(button.dataset.period);

      selectedPeriod =
        Number.isFinite(requestedPeriod) && requestedPeriod > 0
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
    lastAlertKey = null;

    if (simulatorState === "running") {
      prepareNextReading();
      startSimulationTimer(CONFIG.readingInterval);
    } else if (simulatorState === "paused") {
      prepareNextReading();
      animationPausedProgress = 0;
      updateChart();
    }

    showToast(
      `Cenário selecionado: ${scenarios[getScenario()].title}.`,
      "success"
    );
  });

  /*
   * O controle é mantido para preservar a interface,
   * mas a simulação foi definida para atualizar a cada segundo.
   */
  const intervalSelect = getElement("intervalSelect");

  intervalSelect?.addEventListener("change", () => {
    const oneSecondOption = Array.from(intervalSelect.options)
      .find((option) => Number(option.value) === 1);

    if (oneSecondOption) {
      intervalSelect.value = oneSecondOption.value;
    }

    const intervalSummary = getElement("intervalSummary");

    if (intervalSummary) {
      intervalSummary.textContent = "1 s";
    }

    if (simulatorState === "running") {
      prepareNextReading();
      startSimulationTimer(CONFIG.readingInterval);
    } else if (simulatorState === "paused" && pendingReading) {
      animationDuration = CONFIG.readingInterval;
      animationPausedProgress = clamp(animationPausedProgress, 0, 1);
      updateChart();
    }

    showToast(
      "Atualização da simulação configurada para 1 segundo.",
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

  const intervalSelect = getElement("intervalSelect");

  if (intervalSelect) {
    const oneSecondOption = Array.from(intervalSelect.options)
      .find((option) => Number(option.value) === 1);

    if (oneSecondOption) {
      intervalSelect.value = oneSecondOption.value;
    }
  }

  const intervalSummary = getElement("intervalSummary");

  if (intervalSummary) {
    intervalSummary.textContent = "1 s";
  }

  createSoilChart();

  setupNavigation();
  setupChartControls();
  setupSimulatorControls();

  const physicalSensorStatus = getElement("physicalSensorStatus");

  if (physicalSensorStatus) {
    physicalSensorStatus.textContent = "Não conectados";
  }

  console.info(
    "TerraViva iniciado. Dados simulados; leituras a cada 1 segundo; sensores físicos não conectados."
  );
}

document.addEventListener(
  "DOMContentLoaded",
  initializeDashboard
);
