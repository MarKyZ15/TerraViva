
"use strict";

// TerraViva — Dashboard acadêmico
// Os valores abaixo são simulados e NÃO representam medições reais.

const demoData = {
    humidity: [35, 38, 36, 43, 40, 45, 42, 39, 44, 42, 46, 42],
    temperature: [22.1, 22.8, 23.4, 24.1, 23.7, 25.0, 24.5],
    labels: ["08h", "09h", "10h", "11h", "12h", "13h", "14h", "15h", "16h", "17h", "18h", "19h"]
};

function createMiniBars(elementId, values) {
    const container = document.getElementById(elementId);

    if (!container) return;

    container.replaceChildren();

    values.forEach((value) => {
        const bar = document.createElement("span");
        bar.style.height = `${value}%`;
        container.appendChild(bar);
    });
}

function updateClock() {
    const now = new Date();
    const timeElement = document.getElementById("updateTime");
    const dateElement = document.getElementById("updateDate");

    if (timeElement) {
        timeElement.textContent = now.toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit"
        });
    }

    if (dateElement) {
        dateElement.textContent = now.toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "long",
            year: "numeric"
        });
    }
}

function createSoilChart() {
    const canvas = document.getElementById("soilChart");

    if (!canvas || typeof Chart === "undefined") {
        console.warn("Chart.js não foi carregado. Verifique a conexão com a internet.");
        return;
    }

    new Chart(canvas, {
        type: "line",

        data: {
            labels: demoData.labels,
            datasets: [{
                label: "Umidade simulada",
                data: demoData.humidity,
                borderColor: "#a7d96c",
                backgroundColor: "rgba(167, 217, 108, 0.10)",
                borderWidth: 2.5,
                fill: true,
                tension: 0.4,
                pointRadius: 3,
                pointHoverRadius: 6,
                pointBackgroundColor: "#a7d96c",
                pointBorderColor: "#19221b",
                pointBorderWidth: 2
            }]
        },

        options: {
            responsive: true,
            maintainAspectRatio: false,

            interaction: {
                intersect: false,
                mode: "index"
            },

            plugins: {
                legend: {
                    display: false
                },

                tooltip: {
                    backgroundColor: "#263329",
                    titleColor: "#edf4ec",
                    bodyColor: "#c3d3c3",
                    borderColor: "#415442",
                    borderWidth: 1,
                    padding: 12,
                    callbacks: {
                        label(context) {
                            return ` Umidade demonstrativa: ${context.parsed.y}%`;
                        }
                    }
                }
            },

            scales: {
                x: {
                    grid: {
                        display: false
                    },
                    border: {
                        display: false
                    },
                    ticks: {
                        color: "#91a093",
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 7,
                        font: {
                            family: "DM Sans",
                            size: 10
                        }
                    }
                },

                y: {
                    min: 0,
                    max: 100,
                    border: {
                        display: false
                    },
                    grid: {
                        color: "rgba(145, 160, 147, 0.12)"
                    },
                    ticks: {
                        color: "#91a093",
                        stepSize: 20,
                        padding: 9,
                        callback(value) {
                            return `${value}%`;
                        },
                        font: {
                            family: "DM Sans",
                            size: 10
                        }
                    }
                }
            }
        }
    });
}

function initializeDashboard() {
    createMiniBars("humidityBars", [35, 48, 40, 62, 53, 75, 58, 82, 66, 72, 61, 88]);
    createMiniBars("temperatureBars", [40, 48, 43, 58, 51, 67, 61, 78, 65, 72, 60, 75]);

    updateClock();
    createSoilChart();
}

document.addEventListener("DOMContentLoaded", initializeDashboard);
