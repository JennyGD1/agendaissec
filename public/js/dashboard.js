const token = localStorage.getItem('maida_token');
let userRole = 'guest';
let chartStatus, chartTipo, chartSemana, chartColabAgend, chartColabCancel;
let chartPericiaStatus, chartPericiaSemana;

async function iniciarFirebase() {
    try {
        const res = await fetch('/api/firebase-config');
        const config = await res.json();
        if (!firebase.apps.length) {
            firebase.initializeApp(config);
        }
    } catch (error) {
        console.error("Erro ao iniciar Firebase", error);
    }
}
iniciarFirebase();

if (!token) {
    window.location.href = 'login.html';
} else {
    const hoje = new Date();
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    
    document.getElementById('dataInicio').value = primeiroDia.toISOString().split('T')[0];
    document.getElementById('dataFim').value = hoje.toISOString().split('T')[0];

    verificarPermissaoDashboard();
}

async function verificarPermissaoDashboard() {
    try {
        const response = await fetch('/api/me', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) throw new Error('Falha ao obter perfil');
        
        const data = await response.json();
        userRole = data.role;

        if (userRole === 'call_center' || userRole === 'guest') {
            alert('Acesso não autorizado para este perfil.');
            window.location.href = 'index.html';
            return;
        }

        carregarDadosDashboard();

    } catch (error) {
        console.error("Erro de permissão:", error);
        logout();
    }
}

function logout() {
    if (firebase.apps.length) {
        firebase.auth().signOut().then(() => {
            localStorage.clear();
            window.location.href = 'login.html';
        });
    } else {
        localStorage.clear();
        window.location.href = 'login.html';
    }
}

async function carregarDadosDashboard() {
    const inicio = document.getElementById('dataInicio').value;
    const fim = document.getElementById('dataFim').value;

    if(!inicio || !fim) return alert("Selecione o período.");

    try {
        const res = await fetch(`/api/dashboard-stats?inicio=${inicio}&fim=${fim}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if(!res.ok) throw new Error("Erro ao buscar dados");

        const data = await res.json();
        atualizarKPIs(data);
        renderizarGraficos(data);

    } catch (error) {
        console.error(error);
        alert("Erro ao carregar dashboard.");
    }
}

// --- FUNÇÃO CORRIGIDA ABAIXO ---
function atualizarKPIs(data) {
    // Agendamentos
    document.getElementById('kpi-total').innerText = data.total;
    document.getElementById('kpi-atendidos').innerText = data.status.atendido;
    document.getElementById('kpi-absenteismo').innerText = data.status.nao_compareceu;
    document.getElementById('kpi-encaixes').innerText = data.tipo.encaixe;

    // Perícia (O bloco IF deve ficar AQUI DENTRO)
    if (data.pericia) {
        document.getElementById('kpi-pericia-total').innerText = data.pericia.total;
        document.getElementById('kpi-pericia-autorizado').innerText = data.pericia.autorizado;
        document.getElementById('kpi-pericia-indeferido').innerText = data.pericia.indeferido;
        document.getElementById('kpi-pericia-parcial').innerText = data.pericia.parcial;
    }
}

function renderizarGraficos(data) {
    const colors = {
        bluePrimary: '#2979FF',
        pinkNeon: '#FF4081',
        yellow: '#FFC107',
        green: '#00C853',
        greyDark: '#616161',
        greyLight: '#E0E0E0'
    };

    if(chartStatus) chartStatus.destroy();
    if(chartTipo) chartTipo.destroy();
    if(chartSemana) chartSemana.destroy();
    if(chartColabAgend) chartColabAgend.destroy();
    if(chartColabCancel) chartColabCancel.destroy();
    if(chartPericiaStatus) chartPericiaStatus.destroy();
    if(chartPericiaSemana) chartPericiaSemana.destroy();

    Chart.register(ChartDataLabels);

    const percentageFormatter = (value, ctx) => {
        let sum = 0;
        let dataArr = ctx.chart.data.datasets[0].data;
        dataArr.map(data => {
            sum += data;
        });
        if (sum === 0) return '0 (0%)';
        let percentage = (value * 100 / sum).toFixed(1) + "%";
        return value + ' (' + percentage + ')';
    };

    const commonBarOptions = {
        plugins: {
            legend: { display: false },
            datalabels: {
                color: '#333',
                anchor: 'end',
                align: 'end',
                font: { weight: 'bold' },
                formatter: Math.round
            }
        },
        scales: {
            x: {
                grid: { display: false, drawBorder: false },
                ticks: { display: false }
            },
            y: {
                grid: { display: false, drawBorder: false },
                ticks: { display: false }
            }
        },
        layout: {
             padding: {
                 right: 50,
                 top: 20 
             }
        }
    };

    const ctxStatus = document.getElementById('chartStatus').getContext('2d');
    chartStatus = new Chart(ctxStatus, {
        type: 'doughnut',
        data: {
            labels: ['Atendido', 'Não Compareceu', 'Pendente'],
            datasets: [{
                data: [data.status.atendido, data.status.nao_compareceu, data.status.pendente],
                backgroundColor: [colors.green, colors.pinkNeon, colors.yellow],
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        },
        options: {
            plugins: {
                legend: { position: 'bottom' },
                datalabels: { 
                    color: '#fff', 
                    font: { weight: 'bold', size: 11 },
                    formatter: percentageFormatter
                }
            },
            cutout: '60%'
        }
    });

    const ctxTipo = document.getElementById('chartTipo').getContext('2d');
    chartTipo = new Chart(ctxTipo, {
        type: 'pie',
        data: {
            labels: ['Normal', 'Encaixe'],
            datasets: [{
                data: [data.tipo.normal, data.tipo.encaixe],
                backgroundColor: [colors.bluePrimary, colors.pinkNeon],
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        },
         options: {
            plugins: {
                legend: { position: 'bottom' },
                datalabels: { 
                    color: '#fff', 
                    font: { weight: 'bold', size: 12 },
                    formatter: percentageFormatter
                }
            }
        }
    });

    const diasSemana = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const semanaOptions = JSON.parse(JSON.stringify(commonBarOptions));
    semanaOptions.scales.y.ticks = { display: false };
    semanaOptions.scales.x.ticks = { display: true, color: '#666' };
    semanaOptions.plugins.datalabels.align = 'top';
    semanaOptions.plugins.datalabels.anchor = 'end';
    
    semanaOptions.layout.padding.top = 50; 

    const ctxSemana = document.getElementById('chartSemana').getContext('2d');
    chartSemana = new Chart(ctxSemana, {
        type: 'bar',
        data: {
            labels: diasSemana,
            datasets: [{
                data: data.fluxo_semana,
                backgroundColor: colors.bluePrimary,
                borderRadius: 6,
                barPercentage: 0.6
            }]
        },
        options: semanaOptions
    });

    const nomesAgend = Object.keys(data.colaboradores_agend).map(e => e.split('@')[0]);
    const qtdAgend = Object.values(data.colaboradores_agend);
    
    const nomesCancel = Object.keys(data.colaboradores_cancel).map(e => e.split('@')[0]);
    const qtdCancel = Object.values(data.colaboradores_cancel);

    const horizontalOptions = JSON.parse(JSON.stringify(commonBarOptions));
    horizontalOptions.indexAxis = 'y';
    horizontalOptions.scales.y.ticks = { 
        display: true, 
        color: '#333', 
        font: { weight: '500' } 
    };

    const ctxColabAgend = document.getElementById('chartColabAgend').getContext('2d');
    chartColabAgend = new Chart(ctxColabAgend, {
        type: 'bar',
        data: {
            labels: nomesAgend,
            datasets: [{
                data: qtdAgend,
                backgroundColor: colors.bluePrimary,
                borderRadius: 4,
                barPercentage: 0.7
            }]
        },
        options: horizontalOptions
    });

    const ctxColabCancel = document.getElementById('chartColabCancel').getContext('2d');
    chartColabCancel = new Chart(ctxColabCancel, {
        type: 'bar',
        data: {
            labels: nomesCancel,
            datasets: [{
                data: qtdCancel,
                backgroundColor: colors.pinkNeon,
                borderRadius: 4,
                barPercentage: 0.7
            }]
        },
        options: horizontalOptions
    });

    // --- GRÁFICOS DE PERÍCIA ---

    const ctxPericiaStatus = document.getElementById('chartPericiaStatus').getContext('2d');
    chartPericiaStatus = new Chart(ctxPericiaStatus, {
        type: 'doughnut',
        data: {
            labels: ['Autorizado', 'Indeferido', 'Parcial'],
            datasets: [{
                data: [data.pericia.autorizado, data.pericia.indeferido, data.pericia.parcial],
                backgroundColor: [colors.green, colors.pinkNeon, colors.yellow],
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        },
        options: {
            plugins: {
                legend: { position: 'bottom' },
                datalabels: { 
                    color: '#fff', 
                    font: { weight: 'bold', size: 11 },
                    formatter: percentageFormatter
                }
            },
            cutout: '60%'
        }
    });

    const ctxPericiaSemana = document.getElementById('chartPericiaSemana').getContext('2d');
    chartPericiaSemana = new Chart(ctxPericiaSemana, {
        type: 'bar',
        data: {
            labels: diasSemana, // Reutilizando array de dias
            datasets: [{
                data: data.pericia.fluxo_semana,
                backgroundColor: colors.bluePrimary,
                borderRadius: 6,
                barPercentage: 0.6
            }]
        },
        options: semanaOptions // Reutilizando opções verticais
    });
}
