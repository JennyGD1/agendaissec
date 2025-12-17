const token = localStorage.getItem('maida_token');
let userRole = 'guest';
// Variáveis para guardar as instâncias dos gráficos (para poder destruir e recriar)
let chartStatus, chartTipo, chartSemana, chartColabAgend, chartColabCancel;

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
    // Define data inicial como dia 1 do mês atual e data final como hoje
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
        document.getElementById('user-display').textContent = data.email;

        // SEGURANÇA: Bloqueia acesso se for Call Center
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

function atualizarKPIs(data) {
    document.getElementById('kpi-total').innerText = data.total;
    document.getElementById('kpi-atendidos').innerText = data.status.atendido;
    document.getElementById('kpi-absenteismo').innerText = data.status.nao_compareceu;
    document.getElementById('kpi-encaixes').innerText = data.tipo.encaixe;
}

function renderizarGraficos(data) {
    // Destruir gráficos anteriores se existirem para não sobrepor
    if(chartStatus) chartStatus.destroy();
    if(chartTipo) chartTipo.destroy();
    if(chartSemana) chartSemana.destroy();
    if(chartColabAgend) chartColabAgend.destroy();
    if(chartColabCancel) chartColabCancel.destroy();

    // 1. Gráfico de Status (Comparecimento) - PIE
    const ctxStatus = document.getElementById('chartStatus').getContext('2d');
    chartStatus = new Chart(ctxStatus, {
        type: 'doughnut',
        data: {
            labels: ['Atendido', 'Não Compareceu', 'Pendente/Outros'],
            datasets: [{
                data: [data.status.atendido, data.status.nao_compareceu, data.status.pendente],
                backgroundColor: ['#28a745', '#dc3545', '#ffc107']
            }]
        }
    });

    // 2. Gráfico de Tipo (Normal vs Encaixe) - PIE
    const ctxTipo = document.getElementById('chartTipo').getContext('2d');
    chartTipo = new Chart(ctxTipo, {
        type: 'pie',
        data: {
            labels: ['Normal', 'Encaixe'],
            datasets: [{
                data: [data.tipo.normal, data.tipo.encaixe],
                backgroundColor: ['#007bff', '#e83e8c']
            }]
        }
    });

    // 3. Gráfico de Fluxo Semanal - BAR
    const diasSemana = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const ctxSemana = document.getElementById('chartSemana').getContext('2d');
    chartSemana = new Chart(ctxSemana, {
        type: 'bar',
        data: {
            labels: diasSemana,
            datasets: [{
                label: 'Agendamentos',
                data: data.fluxo_semana,
                backgroundColor: 'rgba(54, 162, 235, 0.6)',
                borderColor: 'rgba(54, 162, 235, 1)',
                borderWidth: 1
            }]
        },
        options: { scales: { y: { beginAtZero: true } } }
    });

    // 4. Gráfico Agendamentos por Colaborador - BAR HORIZONTAL
    const emailsAgend = Object.keys(data.colaboradores_agend);
    const qtdAgend = Object.values(data.colaboradores_agend);
    
    // Tratamento para nomes curtos (pegar só antes do @)
    const nomesAgend = emailsAgend.map(e => e.split('@')[0]);

    const ctxColabAgend = document.getElementById('chartColabAgend').getContext('2d');
    chartColabAgend = new Chart(ctxColabAgend, {
        type: 'bar',
        data: {
            labels: nomesAgend,
            datasets: [{
                label: 'Agendamentos Criados',
                data: qtdAgend,
                backgroundColor: 'rgba(75, 192, 192, 0.6)',
                borderColor: 'rgba(75, 192, 192, 1)',
                borderWidth: 1
            }]
        },
        options: { indexAxis: 'y' }
    });

    // 5. Gráfico Cancelamentos por Colaborador - BAR HORIZONTAL
    const emailsCancel = Object.keys(data.colaboradores_cancel);
    const qtdCancel = Object.values(data.colaboradores_cancel);
    const nomesCancel = emailsCancel.map(e => e.split('@')[0]);

    const ctxColabCancel = document.getElementById('chartColabCancel').getContext('2d');
    chartColabCancel = new Chart(ctxColabCancel, {
        type: 'bar',
        data: {
            labels: nomesCancel,
            datasets: [{
                label: 'Cancelamentos Realizados',
                data: qtdCancel,
                backgroundColor: 'rgba(255, 99, 132, 0.6)',
                borderColor: 'rgba(255, 99, 132, 1)',
                borderWidth: 1
            }]
        },
        options: { indexAxis: 'y' }
    });
}
