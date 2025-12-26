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
        if (user) {
            currentUserToken = await user.getIdToken();
            carregarPerfilUsuario();
        } else {
            window.location.href = 'login.html';
        }
    });
}

async function carregarPerfilUsuario() {
    try {
        const response = await fetch('/api/me', {
            headers: { 'Authorization': `Bearer ${currentUserToken}` }
        });
        const data = await response.json();

        const displayEl = document.getElementById('user-display');
        const photoEl = document.getElementById('user-photo');
        const photoContainerEl = document.getElementById('user-photo-container');

        if (displayEl) displayEl.textContent = data.email;

        if (photoEl && photoContainerEl) {
            const urlFoto = data.foto || `https://ui-avatars.com/api/?name=${encodeURIComponent(data.email)}&background=0066cc&color=fff`;
            
            photoEl.src = urlFoto;
            photoContainerEl.style.display = 'flex';

            photoEl.onerror = function() {
                this.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(data.email)}&background=0066cc&color=fff`;
            };
        }
    } catch (e) {
        console.error("Erro ao carregar perfil:", e);
    }
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
    const agora = new Date().toLocaleString('pt-BR');
    const inicio = document.getElementById('dataInicio').value;
    const fim = document.getElementById('dataFim').value;

    function drawHeader(doc, isFirstPage = false) {
        doc.setTextColor(180); 
        doc.setFontSize(8);
        doc.text(`Gerado em: ${agora}`, 195, 8, { align: 'right' });

        const imgElement = document.getElementById('logoImgHidden');
        if (imgElement && imgElement.naturalWidth > 0) {
            try {
                const ratio = imgElement.naturalHeight / imgElement.naturalWidth;
                const logoW = 25;
                const logoH = logoW * ratio;
                doc.addImage(imgElement, 'PNG', 15, 10, logoW, logoH);
            } catch (e) { console.error("Erro logo PDF", e); }
        }

        doc.setTextColor(100);
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.text("Relatório Gerencial", 195, 18, { align: 'right' });
        doc.text("Portal de Agendamentos - ISSEC", 195, 23, { align: 'right' });

        doc.setDrawColor(0, 102, 204);
        doc.setLineWidth(0.7);
        doc.line(15, 33, 195, 33);

        if (isFirstPage) {
            doc.setFontSize(16); 
            doc.setTextColor(30, 30, 30); 
            doc.setFont(undefined, 'bold');
            doc.text("Relatório de Perícia Médica Dermatológica - ISSEC", 105, 42, { align: 'center' });
            
            doc.setFontSize(10); 
            doc.setTextColor(100);
            doc.setFont(undefined, 'normal');
            doc.text(`Período: ${formatarDataPT(inicio)} até ${formatarDataPT(fim)}`, 105, 48, { align: 'center' });
        }
    }

    drawHeader(doc, true);

    const totalFinalizados = dadosRelatorio.atendidos + dadosRelatorio.nao_compareceu;
    const pAtendidos = totalFinalizados > 0 ? ((dadosRelatorio.atendidos / totalFinalizados) * 100).toFixed(1) : 0;
    const pFaltas = totalFinalizados > 0 ? ((dadosRelatorio.nao_compareceu / totalFinalizados) * 100).toFixed(1) : 0;
    const totalGeral = dadosRelatorio.total || 0;
    const pCapital = totalGeral > 0 ? ((dadosRelatorio.regiao.capital / totalGeral) * 100).toFixed(1) : 0;
    const pInterior = totalGeral > 0 ? ((dadosRelatorio.regiao.interior / totalGeral) * 100).toFixed(1) : 0;
    const pMetropolitana = totalGeral > 0 ? ((dadosRelatorio.regiao.metropolitana / totalGeral) * 100).toFixed(1) : 0;

    const cardY = 58; 
    const cardHeight = 95; 
    const cardWidth = 88;
    const card1X = 15;
    const card2X = 107;

    doc.setDrawColor(230); 
    doc.setLineWidth(0.3);

    doc.roundedRect(card1X, cardY, cardWidth, cardHeight, 3, 3, 'S');
    doc.setFontSize(11);
    doc.setTextColor(0, 102, 204); 
    doc.setFont(undefined, 'bold');
    doc.text("Status dos Atendimentos", card1X + (cardWidth / 2), cardY + 8, { align: 'center' });

    try {
        const canvasStatus = document.getElementById('chartStatus');
        const imgStatus = canvasStatus.toDataURL('image/png');
        const ratio = canvasStatus.height / canvasStatus.width;
        const imgW = 45; 
        const imgH = imgW * ratio;
        doc.addImage(imgStatus, 'PNG', card1X + (cardWidth - imgW) / 2, cardY + 12, imgW, imgH);
    } catch(e){}

    const legY = cardY + 68;
    doc.setFontSize(9);
    doc.setFillColor(40, 167, 69);
    doc.rect(card1X + 8, legY - 2.5, 3, 3, 'F');
    doc.setTextColor(80); doc.setFont(undefined, 'normal');
    doc.text(`Atendidos: ${dadosRelatorio.atendidos} (${pAtendidos}%)`, card1X + 13, legY);

    doc.setFillColor(220, 53, 69);
    doc.rect(card1X + 8, legY + 3.5, 3, 3, 'F');
    doc.text(`Não Compareceu: ${dadosRelatorio.nao_compareceu} (${pFaltas}%)`, card1X + 13, legY + 6);

    doc.setFont(undefined, 'bold'); doc.setTextColor(30);
    doc.text(`Total: ${dadosRelatorio.total}`, card1X + 8, legY + 15);

    doc.setDrawColor(230);
    doc.roundedRect(card2X, cardY, cardWidth, cardHeight, 3, 3, 'S');
    doc.setTextColor(0, 102, 204); 
    doc.text("Distribuição por Região", card2X + (cardWidth / 2), cardY + 8, { align: 'center' });

    try {
        const canvasRegiao = document.getElementById('chartRegiao');
        const imgRegiao = canvasRegiao.toDataURL('image/png');
        const ratio = canvasRegiao.height / canvasRegiao.width;
        const imgW = 45;
        const imgH = imgW * ratio;
        doc.addImage(imgRegiao, 'PNG', card2X + (cardWidth - imgW) / 2, cardY + 12, imgW, imgH);
    } catch(e){}

    doc.setFillColor(153, 102, 255);
    doc.rect(card2X + 8, legY - 2.5, 3, 3, 'F');
    doc.setTextColor(80); doc.setFont(undefined, 'normal');
    doc.text(`Capital: ${dadosRelatorio.regiao.capital} (${pCapital}%)`, card2X + 13, legY);

    doc.setFillColor(255, 159, 64);
    doc.rect(card2X + 8, legY + 3.5, 3, 3, 'F');
    doc.text(`Interior: ${dadosRelatorio.regiao.interior} (${pInterior}%)`, card2X + 13, legY + 6);

    doc.setFillColor(75, 192, 192);
    doc.rect(card2X + 8, legY + 9.5, 3, 3, 'F');
    doc.text(`Metropolitana: ${dadosRelatorio.regiao.metropolitana} (${pMetropolitana}%)`, card2X + 13, legY + 12);

    doc.setFont(undefined, 'bold'); doc.setTextColor(30);
    doc.text(`Total: ${dadosRelatorio.total}`, card2X + 8, legY + 20);

    let finalY = cardY + cardHeight + 15;
    const agendamentosPorDia = agruparPorData(dadosRelatorio.lista_detalhada);

    for (const [data, lista] of Object.entries(agendamentosPorDia)) {
        if (finalY > 260) { 
            doc.addPage(); 
            drawHeader(doc, false);
            finalY = 45; 
        }
        
        doc.setFillColor(240, 242, 245);
        doc.rect(15, finalY - 5, 180, 8, 'F');
        doc.setFillColor(0, 102, 204);
        doc.rect(15, finalY - 5, 2, 8, 'F');
        doc.setFontSize(10); 
        doc.setTextColor(50);
        doc.setFont(undefined, 'bold');
        doc.text(data, 20, finalY + 1);
        
        const body = lista.map(item => [item.hora, item.nome_beneficiario, item.numero_cartao, item.regiao, item.status]);

        doc.autoTable({
            startY: finalY + 5,
            head: [['Horário', 'Nome', 'Carteira', 'Região', 'Status']],
            body: body,
            theme: 'grid',
            headStyles: { fillColor: [248, 249, 250], textColor: [50, 50, 50], fontStyle: 'bold', fontSize: 9 },
            styles: { fontSize: 8.5, cellPadding: 3 },
            margin: { left: 15, right: 15 },
            columnStyles: { 0: { cellWidth: 18 }, 4: { fontStyle: 'bold' } },
            didParseCell: function(data) {
                if (data.section === 'body' && data.column.index === 4) {
                    if (data.cell.raw === 'Não Compareceu') data.cell.styles.textColor = [220, 53, 69];
                    if (data.cell.raw === 'Atendido') data.cell.styles.textColor = [40, 167, 69];
                }
            }
        });
        finalY = doc.lastAutoTable.finalY + 15; 
    }

    const pageCount = doc.internal.getNumberOfPages();
    for(let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8); 
        doc.setTextColor(150);
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