async function iniciar() {
    try {
        const res = await fetch('/api/firebase-config');
        const config = await res.json();
        if (!firebase.apps.length) firebase.initializeApp(config);
        firebase.auth().onAuthStateChanged(user => {
            if (user) verificarAcesso();
            else window.location.href = 'login.html';
        });
    } catch (e) { console.error("Erro config:", e); }
}
iniciar();

async function verificarAcesso() {
    const token = localStorage.getItem('maida_token');
    if (!token) return window.location.href = 'login.html';

    try {
        const response = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await response.json();
        
        if (data.role !== 'admin' && data.role !== 'recepcao') {
            alert("Acesso restrito a gestores.");
            window.location.href = 'index.html';
            return;
        }

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
        
        const hoje = new Date().toISOString().split('T')[0];
        document.getElementById('dataInicio').value = hoje;
        document.getElementById('dataFim').value = hoje;
        document.getElementById('dataVisualizar').value = hoje;
        
        gerarGridHorarios();
        carregarHorariosDoBanco(hoje);
    } catch (e) {
        console.error("Erro auth:", e);
        window.location.href = 'login.html';
    }
}

const horariosPadrao = [
    "14:30", "14:37", "14:44", "14:51", "14:58", 
    "15:05", "15:12", "15:19", "15:26", "15:33", "15:40", "15:47", "15:54", 
    "16:01", "16:08", "16:15", "16:22", "16:29", "16:36", "16:43", "16:50", "16:57", 
    "17:04", "17:11", "17:18", "17:25", "17:32", "17:39", "17:46"
];

function gerarGridHorarios() {
    const container = document.getElementById('gridNovos');
    container.innerHTML = '';
    horariosPadrao.forEach(hora => {
        criarCheckHorario(hora, container);
    });
}

function criarCheckHorario(hora, container, checked = false) {
    const id = `check-${hora.replace(':', '')}`;
    if (document.getElementById(id)) return;

    const div = document.createElement('div');
    div.innerHTML = `
        <input type="checkbox" id="${id}" value="${hora}" class="hora-check" ${checked ? 'checked' : ''}>
        <label for="${id}" class="hora-label">${hora}</label>
    `;
    container.appendChild(div);
}

function adicionarHoraManual() {
    const input = document.getElementById('horaManual');
    const hora = input.value;
    if(!hora) return;

    const container = document.getElementById('gridNovos');
    
    const existente = document.querySelector(`input[value="${hora}"]`);
    if (existente) {
        existente.checked = true;
        existente.parentNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
        criarCheckHorario(hora, container, true);
        container.scrollTop = container.scrollHeight;
    }
    input.value = '';
}

function alternarSelecao() {
    const checks = document.querySelectorAll('.hora-check');
    const texto = document.getElementById('texto-marcar');
    const todosMarcados = Array.from(checks).every(c => c.checked);
    const novoEstado = !todosMarcados;
    checks.forEach(c => c.checked = novoEstado);
    texto.innerText = novoEstado ? "Desmarcar Todos" : "Marcar Todos";
}

async function salvarLote() {
    const inicio = document.getElementById('dataInicio').value;
    const fim = document.getElementById('dataFim').value;
    const diasSemana = Array.from(document.querySelectorAll('.weekdays-selector input:checked')).map(cb => parseInt(cb.value));
    const slotsSelecionados = Array.from(document.querySelectorAll('.hora-check:checked')).map(cb => cb.value);

    if (!inicio || !fim) return exibirModal("Atenção", "Selecione a data de início e fim.");
    if (slotsSelecionados.length === 0) return exibirModal("Atenção", "Selecione pelo menos um horário.");
    if (diasSemana.length === 0) return exibirModal("Atenção", "Selecione pelo menos um dia da semana.");

    const listaDatas = [];
    let dataAtual = new Date(inicio + 'T00:00:00');
    const dataFinal = new Date(fim + 'T00:00:00');

    if (dataFinal < dataAtual) return exibirModal("Erro", "Data final deve ser maior ou igual à inicial.");

    while (dataAtual <= dataFinal) {
        if (diasSemana.includes(dataAtual.getDay())) {
            listaDatas.push(dataAtual.toISOString().split('T')[0]);
        }
        dataAtual.setDate(dataAtual.getDate() + 1);
    }

    if (listaDatas.length === 0) return exibirModal("Aviso", "Nenhuma data válida no intervalo.");

    exibirModal("Confirmar Criação", 
        `Criar ${slotsSelecionados.length} horários para ${listaDatas.length} dias?\n(Total: ${slotsSelecionados.length * listaDatas.length} slots)`, 
        async () => {
            const token = localStorage.getItem('maida_token');
            try {
                const response = await fetch('/api/admin/slots', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ datas: listaDatas, slots: slotsSelecionados })
                });

                if (response.ok) {
                    const res = await response.json();
                    exibirModal("Sucesso", res.message || "Horários criados!");
                    document.querySelectorAll('.hora-check').forEach(cb => cb.checked = false);
                    document.getElementById('texto-marcar').innerText = "Marcar Todos";
                    document.getElementById('dataVisualizar').value = inicio;
                    carregarHorariosDoBanco(inicio);
                } else {
                    const err = await response.json();
                    exibirModal("Erro", err.error);
                }
            } catch (e) {
                exibirModal("Erro", "Erro de conexão.");
            }
        }
    );
}

async function carregarHorariosDoBanco(dataIso) {
    if (!dataIso) return;
    const ul = document.getElementById('listaSlotsBanco');
    const loader = document.getElementById('loadingExistentes');
    ul.innerHTML = '';
    loader.style.display = 'block';

    const token = localStorage.getItem('maida_token');

    try {
        const response = await fetch(`/api/admin/slots?data=${dataIso}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const slots = await response.json();
        loader.style.display = 'none';

        if (!response.ok || slots.length === 0) {
            ul.innerHTML = '<p style="grid-column: 1/-1; text-align:center; color:#999; margin-top:10px;">Nenhum horário cadastrado nesta data.</p>';
            return;
        }

        slots.sort((a, b) => a.hora.localeCompare(b.hora));

        slots.forEach(slot => {
            const li = document.createElement('li');
            li.className = `slot-item ${slot.disponivel ? 'livre' : 'ocupado'}`;
            
            let html = `${slot.hora}`;
            
            if (slot.disponivel) {
                html += `<button class="btn-del-slot" onclick="excluirSlot(${slot.id})" title="Excluir">×</button>`;
            } else {
                li.title = "Ocupado (Possui agendamento)";
                html += ` 
                <span class="icon-lock" title="Ocupado">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                </span>`;
            }
            
            li.innerHTML = html;
            ul.appendChild(li);
        });

    } catch (error) {
        loader.style.display = 'none';
        ul.innerHTML = '<p style="color:red; text-align:center;">Erro ao carregar lista.</p>';
    }
}

async function excluirSlot(id) {
    exibirModal("Confirmar Exclusão", "Deseja excluir este horário permanentemente?", async () => {
        const token = localStorage.getItem('maida_token');
        try {
            const response = await fetch(`/api/admin/slots/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                carregarHorariosDoBanco(document.getElementById('dataVisualizar').value);
            } else {
                const res = await response.json();
                exibirModal("Erro", res.error);
            }
        } catch (e) {
            exibirModal("Erro", "Erro de conexão.");
        }
    });
}

function exibirModal(titulo, mensagem, callbackConfirmacao = null) {
    const modal = document.getElementById('modalSistema');
    document.getElementById('modalTitulo').innerText = titulo;
    document.getElementById('modalMensagem').innerText = mensagem;
    const btnContainer = document.getElementById('modalBotoes');
    btnContainer.innerHTML = '';

    if (callbackConfirmacao) {
        const btnSim = document.createElement('button');
        btnSim.className = 'btn-modal btn-confirm';
        btnSim.innerText = 'Confirmar';
        btnSim.onclick = () => { fecharModal(); callbackConfirmacao(); };
        
        const btnNao = document.createElement('button');
        btnNao.className = 'btn-modal btn-cancel';
        btnNao.innerText = 'Cancelar';
        btnNao.onclick = fecharModal;

        btnContainer.appendChild(btnNao);
        btnContainer.appendChild(btnSim);
    } else {
        const btnOk = document.createElement('button');
        btnOk.className = 'btn-modal btn-confirm';
        btnOk.innerText = 'OK';
        btnOk.onclick = fecharModal;
        btnContainer.appendChild(btnOk);
    }
    modal.style.display = 'flex';
}
function logout() { 
    localStorage.clear(); 
    window.location.href = 'login.html'; 
}
function fecharModal() {
    document.getElementById('modalSistema').style.display = 'none';
}
async function excluirTodosDoDia() {
    const dataIso = document.getElementById('dataVisualizar').value;
    if (!dataIso) return;

    const dataBR = dataIso.split('-').reverse().join('/');

    exibirModal("Confirmar Exclusão em Massa", 
        `Deseja realmente apagar TODOS os horários do dia ${dataBR}? Esta ação só será permitida se não houver agendamentos.`, 
        async () => {
            const token = localStorage.getItem('maida_token');
            try {
                const response = await fetch(`/api/admin/slots/date/${dataIso}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (response.ok) {
                    const res = await response.json();
                    exibirModal("Sucesso", res.message);
                    carregarHorariosDoBanco(dataIso);
                } else {
                    const err = await response.json();
                    exibirModal("Erro", err.error || "Erro ao excluir horários.");
                }
            } catch (e) {
                exibirModal("Erro", "Erro de conexão com o servidor.");
            }
        }
    );
}

window.onclick = function(event) {
    if (event.target.classList.contains('modal-overlay-custom')) fecharModal();
}
