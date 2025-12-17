let currentUserToken = null;
let dadosRelatorio = null;
let chartsInstances = {};

async function iniciar() {
    const res = await fetch('/api/firebase-config');
    const config = await res.json();
    if (!firebase.apps.length) firebase.initializeApp(config);

    const date = new Date();
    const primeiroDia = new Date(date.getFullYear(), date.getMonth(), 1);
    const ultimoDia = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    
    document.getElementById('dataInicio').value = primeiroDia.toISOString().split('T')[0];
    document.getElementById('dataFim').value = ultimoDia.toISOString().split('T')[0];

    firebase.auth().onAuthStateChanged(async (user) => {
        if (user) currentUserToken = await user.getIdToken();
        else window.location.href = 'login.html';
    });
}

async function buscarDados() {
    const inicio = document.getElementById('dataInicio').value;
    const fim = document.getElementById('dataFim').value;

    if (!inicio || !fim) return alert("Selecione as datas.");
    if (!currentUserToken) return alert("Autenticando...");

    try {
        const response = await fetch(`/api/relatorios?inicio=${inicio}&fim=${fim}`, {
            headers: { 'Authorization': `Bearer ${currentUserToken}` }
        });
        
        if (!response.ok) throw new Error('Erro na API');
        
        dadosRelatorio = await response.json();
        renderizarRelatorio(dadosRelatorio, inicio, fim);
    } catch (error) {
        console.error(error);
        alert("Erro ao buscar dados.");
    }
}

function renderizarRelatorio(dados, inicio, fim) {
    const container = document.getElementById('conteudoDinamico');
    
    const totalFinalizados = dados.atendidos + dados.nao_compareceu;
    const pAtendidos = totalFinalizados > 0 ? ((dados.atendidos / totalFinalizados) * 100).toFixed(1) : 0;
    const pFaltas = totalFinalizados > 0 ? ((dados.nao_compareceu / totalFinalizados) * 100).toFixed(1) : 0;
    
    const totalGeral = dados.total || 0;
    const pCapital = totalGeral > 0 ? ((dados.regiao.capital / totalGeral) * 100).toFixed(1) : 0;
    const pInterior = totalGeral > 0 ? ((dados.regiao.interior / totalGeral) * 100).toFixed(1) : 0;
    const pMetropolitana = totalGeral > 0 ? ((dados.regiao.metropolitana / totalGeral) * 100).toFixed(1) : 0;

    let html = `
        <div class="report-title">Relatório de Perícia Médica Dermatológica - ISSEC</div>
        <div class="report-period">Período: ${formatarDataPT(inicio)} até ${formatarDataPT(fim)}</div>
        
        <div class="charts-section">
            <div class="chart-wrapper">
                <h4>Status dos Atendimentos</h4>
                <div class="canvas-box">
                    <canvas id="chartStatus"></canvas>
                </div>
                <div class="chart-legend">
                    <div class="legend-item"><span style="color:#28a745">■ Atendidos:</span> <span>${dados.atendidos} (${pAtendidos}%)</span></div>
                    <div class="legend-item"><span style="color:#dc3545">■ Não Compareceu:</span> <span>${dados.nao_compareceu} (${pFaltas}%)</span></div>
                    <div class="legend-item total"><span>Total:</span> <span>${dados.total}</span></div>
                </div>
            </div>

            <div class="chart-wrapper">
                <h4>Distribuição por Região</h4>
                <div class="canvas-box">
                    <canvas id="chartRegiao"></canvas>
                </div>
                <div class="chart-legend">
                    <div class="legend-item"><span style="color:#9966FF">■ Capital:</span> <span>${dados.regiao.capital} (${pCapital}%)</span></div>
                    <div class="legend-item"><span style="color:#FF9F40">■ Interior:</span> <span>${dados.regiao.interior} (${pInterior}%)</span></div>
                    <div class="legend-item"><span style="color:#4BC0C0">■ Metropolitana:</span> <span>${dados.regiao.metropolitana} (${pMetropolitana}%)</span></div>
                    <div class="legend-item total"><span>Total:</span> <span>${dados.total}</span></div>
                </div>
            </div>
        </div>

        <div id="tabelasArea"></div>
    `;
    container.innerHTML = html;

    let htmlTabelas = '';
    const agendamentosPorDia = agruparPorData(dados.lista_detalhada);
    
    for (const [data, lista] of Object.entries(agendamentosPorDia)) {
        htmlTabelas += `
            <div class="date-section">
                <div class="date-title">${data}</div>
                <table>
                    <thead>
                        <tr>
                            <th width="12%">Horário</th>
                            <th width="38%">Nome</th>
                            <th width="15%">Carteira</th>
                            <th width="15%">Região</th>
                            <th width="20%">Status</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        lista.forEach(item => {
            let cls = '';
            if(item.status === 'Atendido') cls = 'status-atendido';
            if(item.status === 'Não Compareceu') cls = 'status-falta';
            
            htmlTabelas += `
                <tr>
                    <td>${item.hora}</td>
                    <td>${item.nome_beneficiario}</td>
                    <td>${item.numero_cartao || '-'}</td>
                    <td>${item.regiao || '-'}</td>
                    <td class="${cls}">${item.status}</td>
                </tr>
            `;
        });
        htmlTabelas += `</tbody></table></div>`;
    }
    document.getElementById('tabelasArea').innerHTML = htmlTabelas;

    criarGraficos(dados);
}

function criarGraficos(dados) {
    if (chartsInstances.status) chartsInstances.status.destroy();
    if (chartsInstances.regiao) chartsInstances.regiao.destroy();

    const commonOptions = {
        maintainAspectRatio: false,
        responsive: true,
        plugins: { legend: { display: false } },
        layout: { padding: 10 }
    };

    const ctxStatus = document.getElementById('chartStatus').getContext('2d');
    chartsInstances.status = new Chart(ctxStatus, {
        type: 'doughnut',
        data: {
            labels: ['Atendido', 'Não Compareceu'],
            datasets: [{
                data: [dados.atendidos, dados.nao_compareceu],
                backgroundColor: ['#28a745', '#dc3545'], 
                borderWidth: 0
            }]
        },
        options: commonOptions
    });

    const ctxRegiao = document.getElementById('chartRegiao').getContext('2d');
    chartsInstances.regiao = new Chart(ctxRegiao, {
        type: 'pie',
        data: {
            labels: ['Capital', 'Interior', 'Metropolitana'],
            datasets: [{
                data: [dados.regiao.capital, dados.regiao.interior, dados.regiao.metropolitana],
                backgroundColor: ['#9966FF', '#FF9F40', '#4BC0C0'],
                borderWidth: 0
            }]
        },
        options: commonOptions
    });
}

async function baixarPDF() {
    if (!dadosRelatorio) return alert("Gere o relatório na tela primeiro.");
    
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    const inicio = document.getElementById('dataInicio').value;
    const fim = document.getElementById('dataFim').value;
    const periodoTexto = `Período: ${formatarDataPT(inicio)} a ${formatarDataPT(fim)}`;
    const agora = new Date().toLocaleString('pt-BR');

    // --- CABEÇALHO ---
    function drawHeader(doc) {
        doc.setTextColor(200); 
        doc.setFontSize(8);
        doc.text(`Gerado em: ${agora}`, 200, 8, { align: 'right' });

        const imgElement = document.getElementById('logoImgHidden');
        try {
            const logoWidth = 30; 
            let logoHeight = 20; 
            if (imgElement.naturalWidth > 0) {
                const ratio = imgElement.naturalHeight / imgElement.naturalWidth;
                logoHeight = logoWidth * ratio;
            }
            doc.addImage(imgElement, 'PNG', 14, 10, logoWidth, logoHeight); 
        } catch (e) {}

        doc.setFontSize(16); 
        doc.setTextColor(0, 0, 0); 
        doc.setFont(undefined, 'bold');
        doc.text("Relatório de Perícia Médica Dermatológica - ISSEC", 105, 40, { align: 'center' });
        doc.setFont(undefined, 'normal');
        
        doc.setFontSize(10); 
        doc.setTextColor(100);
        doc.text(periodoTexto, 105, 46, { align: 'center' });
    }

    drawHeader(doc);

    // --- DADOS ---
    const totalFinalizados = dadosRelatorio.atendidos + dadosRelatorio.nao_compareceu;
    const pAtendidos = totalFinalizados > 0 ? ((dadosRelatorio.atendidos / totalFinalizados) * 100).toFixed(1) : 0;
    const pFaltas = totalFinalizados > 0 ? ((dadosRelatorio.nao_compareceu / totalFinalizados) * 100).toFixed(1) : 0;
    const totalGeral = dadosRelatorio.total || 0;
    const pCapital = totalGeral > 0 ? ((dadosRelatorio.regiao.capital / totalGeral) * 100).toFixed(1) : 0;
    const pInterior = totalGeral > 0 ? ((dadosRelatorio.regiao.interior / totalGeral) * 100).toFixed(1) : 0;
    const pMetropolitana = totalGeral > 0 ? ((dadosRelatorio.regiao.metropolitana / totalGeral) * 100).toFixed(1) : 0;

    const cardY = 55;
    const cardHeight = 100; 
    const cardWidth = 88;
    const card1X = 14;
    const card2X = 108; 

    // Configuração da Borda Leve
    doc.setDrawColor(220); 
    doc.setLineWidth(0.5);

    // --- CARD 1: STATUS ---
    doc.roundedRect(card1X, cardY, cardWidth, cardHeight, 3, 3, 'S');
    
    // Título
    doc.setFontSize(11);
    doc.setTextColor(0, 102, 204); 
    doc.setFont(undefined, 'bold');
    doc.text("Status dos Atendimentos", card1X + (cardWidth / 2), cardY + 10, { align: 'center' });

    try {
        const imgStatus = document.getElementById('chartStatus').toDataURL('image/png');
        const ratioStatus = document.getElementById('chartStatus').height / document.getElementById('chartStatus').width;
        const imgW = 55; 
        const imgH = imgW * ratioStatus;
        doc.addImage(imgStatus, 'PNG', card1X + (cardWidth - imgW) / 2, cardY + 15, imgW, imgH);
    } catch(e){}

    // Legenda
    const legendY = cardY + 75;
    doc.setFontSize(9);
    
    // Item 1: Atendidos (Quadrado Verde)
    doc.setFillColor(40, 167, 69); 
    doc.rect(card1X + 5, legendY - 2.5, 3, 3, 'F'); 
    doc.setTextColor(80); 
    doc.setFont(undefined, 'normal');
    doc.text("Atendidos:", card1X + 10, legendY);
    doc.text(`${dadosRelatorio.atendidos} (${pAtendidos}%)`, card1X + cardWidth - 5, legendY, {align:'right'});

    // Item 2: Não Compareceu (Quadrado Vermelho)
    doc.setFillColor(220, 53, 69);
    doc.rect(card1X + 5, legendY + 3.5, 3, 3, 'F');
    doc.text("Não Compareceu:", card1X + 10, legendY + 6);
    doc.text(`${dadosRelatorio.nao_compareceu} (${pFaltas}%)`, card1X + cardWidth - 5, legendY + 6, {align:'right'});

    // Total
    doc.setDrawColor(230);
    doc.line(card1X + 5, legendY + 10, card1X + cardWidth - 5, legendY + 10);
    doc.setTextColor(0); 
    doc.setFont(undefined, 'bold');
    doc.text("Total:", card1X + 5, legendY + 16);
    doc.text(`${dadosRelatorio.total}`, card1X + cardWidth - 5, legendY + 16, {align:'right'});

    // --- CARD 2: REGIÃO ---
    doc.setDrawColor(220);
    doc.roundedRect(card2X, cardY, cardWidth, cardHeight, 3, 3, 'S');

    // Título
    doc.setTextColor(0, 102, 204); 
    doc.setFont(undefined, 'bold');
    doc.text("Distribuição por Região", card2X + (cardWidth / 2), cardY + 10, { align: 'center' });

    // Imagem (AUMENTADA)
    try {
        const imgRegiao = document.getElementById('chartRegiao').toDataURL('image/png');
        const ratioRegiao = document.getElementById('chartRegiao').height / document.getElementById('chartRegiao').width;
        const imgW = 55; // Aumentado
        const imgH = imgW * ratioRegiao;
        doc.addImage(imgRegiao, 'PNG', card2X + (cardWidth - imgW) / 2, cardY + 15, imgW, imgH);
    } catch(e){}

    // Legenda
    doc.setFontSize(9);

    // Capital (Quadrado Roxo)
    doc.setFillColor(153, 102, 255);
    doc.rect(card2X + 5, legendY - 2.5, 3, 3, 'F');
    doc.setTextColor(80); 
    doc.setFont(undefined, 'normal');
    doc.text("Capital:", card2X + 10, legendY);
    doc.text(`${dadosRelatorio.regiao.capital} (${pCapital}%)`, card2X + cardWidth - 5, legendY, {align:'right'});

    // Interior (Quadrado Laranja)
    doc.setFillColor(255, 159, 64);
    doc.rect(card2X + 5, legendY + 3.5, 3, 3, 'F');
    doc.text("Interior:", card2X + 10, legendY + 6);
    doc.text(`${dadosRelatorio.regiao.interior} (${pInterior}%)`, card2X + cardWidth - 5, legendY + 6, {align:'right'});

    // Metropolitana (Quadrado Verde Água)
    doc.setFillColor(75, 192, 192);
    doc.rect(card2X + 5, legendY + 9.5, 3, 3, 'F');
    doc.text("Metropolitana:", card2X + 10, legendY + 12);
    doc.text(`${dadosRelatorio.regiao.metropolitana} (${pMetropolitana}%)`, card2X + cardWidth - 5, legendY + 12, {align:'right'});

    // Total
    doc.setDrawColor(230);
    doc.line(card2X + 5, legendY + 16, card2X + cardWidth - 5, legendY + 16);
    doc.setTextColor(0); 
    doc.setFont(undefined, 'bold');
    doc.text("Total:", card2X + 5, legendY + 22);
    doc.text(`${dadosRelatorio.total}`, card2X + cardWidth - 5, legendY + 22, {align:'right'});

    // --- TABELAS ---
    let finalY = cardY + cardHeight + 15; 
    const agendamentosPorDia = agruparPorData(dadosRelatorio.lista_detalhada);

    for (const [data, lista] of Object.entries(agendamentosPorDia)) {
        if (finalY > 260) { 
            doc.addPage(); 
            finalY = 20; 
            drawHeader(doc);
        }
        
        doc.setFillColor(233, 236, 239);
        doc.rect(14, finalY - 4, 182, 7, 'F'); 
        doc.setFillColor(0, 102, 204);
        doc.rect(14, finalY - 4, 2, 7, 'F');
        doc.setFontSize(10); 
        doc.setTextColor(73, 80, 87);
        doc.setFont(undefined, 'bold');
        doc.text(data, 19, finalY + 1);
        doc.setFont(undefined, 'normal');
        
        const body = lista.map(item => [item.hora, item.nome_beneficiario, item.numero_cartao, item.regiao, item.status]);

        doc.autoTable({
            startY: finalY + 4,
            head: [['Horário', 'Nome', 'Carteira', 'Região', 'Status']],
            body: body,
            theme: 'grid',
            headStyles: { fillColor: [248, 249, 250], textColor: [50, 50, 50], fontStyle: 'bold' },
            styles: { fontSize: 8, cellPadding: 2 },
            margin: { top: 55 }, 
            columnStyles: { 0: { cellWidth: 15 }, 4: { fontStyle: 'bold' } },
            didParseCell: function(data) {
                if (data.section === 'body' && data.column.index === 4) {
                    if (data.cell.raw === 'Não Compareceu') data.cell.styles.textColor = [220, 53, 69];
                    if (data.cell.raw === 'Atendido') data.cell.styles.textColor = [40, 167, 69];
                }
            }
        });
        finalY = doc.lastAutoTable.finalY + 12;
    }

    // Rodapés
    const pageCount = doc.internal.getNumberOfPages();
    for(let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        
        doc.setFontSize(8); 
        doc.setTextColor(150);
        if (i === pageCount) {
            const rodapeL1 = "Av. Santos Dumont, 5335 (11º andar) - Papicu, Fortaleza - CE, CEP 60175-047";
            const rodapeL2 = "Telefone: 0800 022 4050 | E-mail: pericia.issec@maida.health";
            doc.text(rodapeL1, 105, 285, { align: 'center' });
            doc.text(rodapeL2, 105, 289, { align: 'center' });
        }
        doc.text(`Página ${i} de ${pageCount}`, 195, 290, { align: 'right' });
    }

    const cleanDate = inicio.replace(/[^0-9]/g, '');
    doc.save(`Relatorio_Agendamentos_${cleanDate}.pdf`);
}

function agruparPorData(lista) {
    return lista.reduce((acc, item) => {
        const data = item.data_formatada;
        if (!acc[data]) acc[data] = [];
        acc[data].push(item);
        return acc;
    }, {});
}

function formatarDataPT(dataIso) {
    if(!dataIso) return '';
    const [ano, mes, dia] = dataIso.split('-');
    return `${dia}/${mes}/${ano}`;
}

document.addEventListener('DOMContentLoaded', function() {
    iniciar();
});