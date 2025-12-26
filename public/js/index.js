const token = localStorage.getItem('maida_token');
let filtroStatusAtual = null;
let userRole = 'guest';
let idAgendamentoParaCancelar = null;

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
    const hoje = new Date().toISOString().split('T')[0];
    document.getElementById('filtroData').value = hoje;
    checarPermissoes();
}

async function checarPermissoes() {
    if (!token) return;

    try {
        const response = await fetch('/api/me', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) throw new Error('Falha ao obter perfil');
        
        const data = await response.json();
        userRole = data.role;
        
        document.getElementById('user-display').textContent = data.email;

        aplicarRestricoesVisuais();
        carregarAgendamentos();
        
        if (userRole === 'admin' || userRole === 'recepcao') {
            verificarPendencias();
        }

    } catch (error) {
        console.error("Erro ao verificar permissões", error);
    }
}

function aplicarRestricoesVisuais() {
    const linkAgendar = document.querySelector('nav a[href="agendar.html"]');
    const linkPericia = document.querySelector('nav a[href="periciadocumental.html"]'); 
    const linkGerenciar = document.getElementById('link-gerenciar');
    const menuFuncoes = document.getElementById('menu-funcoes');
    const btnEncaixe = document.getElementById('btnEncaixe');

    if(linkAgendar) linkAgendar.style.display = 'none';
    if(linkPericia) linkPericia.style.display = 'none'; 
    if(linkGerenciar) linkGerenciar.style.display = 'none';
    if(menuFuncoes) menuFuncoes.style.display = 'none';
    if(btnEncaixe) btnEncaixe.style.display = 'none';

    if (userRole === 'cliente') {
        if(menuFuncoes) menuFuncoes.style.display = 'inline-block';
    }
    else if (userRole === 'call_center') {
        if(linkAgendar) linkAgendar.style.display = 'inline-block';
    }
    else if (userRole === 'admin' || userRole === 'recepcao') {
        if(linkAgendar) linkAgendar.style.display = 'inline-block';
        if(linkPericia) linkPericia.style.display = 'block'; 
        if(linkGerenciar) linkGerenciar.style.display = 'inline-block';
        if(menuFuncoes) menuFuncoes.style.display = 'inline-block';
        if(btnEncaixe) btnEncaixe.style.display = 'flex';
    }
}

function logout() {
    if (firebase.apps.length) {
        firebase.auth().signOut().then(() => {
            localStorage.clear();
            window.location.href = 'login.html';
        }).catch((error) => {
            localStorage.clear();
            window.location.href = 'login.html';
        });
    } else {
        localStorage.clear();
        window.location.href = 'login.html';
    }
}

function abrirModalCancelamento(id) {
    idAgendamentoParaCancelar = id;
    document.getElementById('inputProtocoloCancelamento').value = '';
    verificarInputProtocolo();
    document.getElementById('modalCancelamento').style.display = 'flex';
    
    setTimeout(() => {
        document.getElementById('inputProtocoloCancelamento').focus();
    }, 50);
}

function verificarInputProtocolo() {
    const input = document.getElementById('inputProtocoloCancelamento').value;
    const btn = document.getElementById('btnConfirmarCancelamento');
    
    if (input && input.trim().length > 0) {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
    } else {
        btn.disabled = true;
        btn.style.opacity = '0.6';
        btn.style.cursor = 'not-allowed';
    }
}

async function executarCancelamento() {
    if (!idAgendamentoParaCancelar) return;
    
    const protocolo = document.getElementById('inputProtocoloCancelamento').value;
    const btn = document.getElementById('btnConfirmarCancelamento');
    
    btn.innerText = 'Processando...';
    btn.disabled = true;

    try {
        const response = await fetch(`/api/agendamentos/${idAgendamentoParaCancelar}`, {
            method: 'DELETE',
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({ protocolo: protocolo })
        });

        if (response.ok) {
            fecharModal('modalCancelamento');
            
            exibirModal('Sucesso', 'Cancelamento realizado com sucesso!');
            
            carregarAgendamentos();
            if (userRole === 'admin' || userRole === 'recepcao') verificarPendencias();
        } else {
            const erro = await response.json();
            exibirModal('Erro', erro.error || 'Falha ao cancelar');
        }
    } catch (error) {
        console.error(error);
        exibirModal('Erro', 'Erro de conexão.');
    } finally {
        btn.innerText = 'Confirmar';
        btn.disabled = false;
    }
}

function abrirModalEncaixe() {
    const agora = new Date();
    const horaFormatada = agora.toTimeString().substring(0,5);
    document.getElementById('encaixeHora').value = horaFormatada;
    document.getElementById('modalEncaixe').style.display = 'flex';
}

async function buscarEncaixeApi() {
    const nome = document.getElementById('encaixeNome').value;
    const lista = document.getElementById('listaSugestoesEncaixe');
    if(nome.length < 3) return;

    lista.style.display = 'block';
    lista.innerHTML = '<li>Buscando...</li>';

    try {
        const response = await fetch(`/api/buscar-beneficiario?nome=${encodeURIComponent(nome)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        lista.innerHTML = '';
        
        if (data.content && data.content.length > 0) {
            data.content.forEach(p => {
                const li = document.createElement('li');
                li.innerHTML = `<strong>${p.nome}</strong><br><small>${p.numeroCartao || 'S/ Cartão'}</small>`;
                li.onclick = () => {
                    document.getElementById('encaixeNome').value = p.nome;
                    document.getElementById('encaixeCartao').value = p.numeroCartao || '';
                    lista.style.display = 'none';
                };
                lista.appendChild(li);
            });
        } else {
            lista.innerHTML = '<li>Nenhum encontrado</li>';
        }
    } catch (e) {
        lista.innerHTML = '<li>Erro na busca</li>';
    }
}

async function salvarEncaixe(force = false) {
    const hora = document.getElementById('encaixeHora').value;
    const nome = document.getElementById('encaixeNome').value;
    const cartao = document.getElementById('encaixeCartao').value;
    const emailContato = document.getElementById('encaixeEmail').value.trim();
    const contatoEl = document.getElementById('encaixeContato');
    const contato = contatoEl ? contatoEl.value.trim() : '';
    
    if(!hora || !nome) {
        return exibirModal('Atenção', 'Preencha Hora e Nome do Beneficiário.');
    }

    const regexTelefone = /^\(\d{2}\) \d \d{4}-\d{4}$/;
    
    if (!contato) {
        return exibirModal('Atenção', 'O telefone é obrigatório para realizar o encaixe.');
    }

    if (!regexTelefone.test(contato)) {
        return exibirModal('Atenção', 'Telefone inválido! Use o formato: (85) 9 9999-9999');
    }

    const btn = document.getElementById('btnConfirmarEncaixe');
    const textoOriginal = "Confirmar Encaixe";
    
    if (btn && !force) {
        btn.innerText = "Salvando...";
        btn.disabled = true;
    }

    const payload = {
        hora, nome, cartao,
        contato: contato,
        email_contato: emailContato,
        regiao: document.getElementById('encaixeRegiao').value,
        obs: document.getElementById('encaixeObs').value,
        force: force
    };

    try {
        const response = await fetch('/api/encaixe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });

        if(response.ok) {
            exibirModal('Sucesso', 'Encaixe realizado com sucesso!');
            
            fecharModal('modalEncaixe');
            document.getElementById('filtroData').value = new Date().toISOString().split('T')[0];
            carregarAgendamentos();
            
            document.getElementById('encaixeNome').value = '';
            document.getElementById('encaixeCartao').value = '';
            document.getElementById('encaixeContato').value = '';
            document.getElementById('encaixeEmail').value = '';
            document.getElementById('encaixeObs').value = '';
            
            if (btn) {
                btn.innerText = textoOriginal;
                btn.disabled = false;
            }
        } else {
            const erro = await response.json();
            
            if (response.status === 409 && erro.type === 'FUTURE_ENTRY') {
                exibirModal(
                    'Agendamento Futuro Identificado', 
                    `Beneficiário já agendado para o dia ${erro.data} às ${erro.hora}. Por gentileza, cancele o agendamento futuro para realizar o encaixe.`
                );
                if (btn) {
                    btn.innerText = textoOriginal;
                    btn.disabled = false;
                }
                return;
            }

            if (response.status === 409 && erro.type === 'DUPLICATE_ENTRY') {
                document.getElementById('horaDuplicidadeTxt').innerText = erro.hora;
                document.getElementById('modalDuplicidade').style.display = 'flex';
                return;
            } else {
                exibirModal('Erro', erro.error || 'Erro desconhecido');
                if (btn) {
                    btn.innerText = textoOriginal;
                    btn.disabled = false;
                }
            }
        }
    } catch (e) {
        console.error(e);
        exibirModal('Erro', 'Erro de conexão');
        if (btn) {
            btn.innerText = textoOriginal;
            btn.disabled = false;
        }
    }
}

function confirmarDuplicidade() {
    fecharModal('modalDuplicidade');
    salvarEncaixe(true);
}

function cancelarDuplicidade() {
    fecharModal('modalDuplicidade');
    
    const btn = document.querySelector('#modalEncaixe button[onclick="salvarEncaixe()"]');
    if (btn) {
        btn.innerText = "Confirmar Encaixe";
        btn.disabled = false;
    }
}

function exibirModal(titulo, mensagem, callbackConfirmacao = null) {
    const modal = document.getElementById('modalSistema');
    const tituloEl = document.getElementById('modalTitulo');
    const msgEl = document.getElementById('modalMensagem');
    const btnContainer = document.getElementById('modalBotoes');

    tituloEl.innerText = titulo || 'Aviso';
    msgEl.innerText = mensagem;
    btnContainer.innerHTML = '';

    if (callbackConfirmacao) {
        const btnSim = document.createElement('button');
        btnSim.className = 'btn-modal-custom btn-confirm-custom';
        btnSim.innerText = 'Confirmar';
        btnSim.onclick = () => { fecharModal('modalSistema'); callbackConfirmacao(); };
        
        const btnNao = document.createElement('button');
        btnNao.className = 'btn-modal-custom btn-cancel-custom';
        btnNao.innerText = 'Cancelar';
        btnNao.onclick = () => fecharModal('modalSistema');

        btnContainer.appendChild(btnNao);
        btnContainer.appendChild(btnSim);
    } else {
        const btnOk = document.createElement('button');
        btnOk.className = 'btn-modal-custom btn-confirm-custom';
        btnOk.innerText = 'OK';
        btnOk.onclick = () => fecharModal('modalSistema');
        btnContainer.appendChild(btnOk);
    }
    modal.style.display = 'flex';
}

function fecharModal(id) {
    document.getElementById(id).style.display = 'none';
}

function abrirModalObs(texto) {
    document.getElementById('modalObsTexto').innerText = texto;
    document.getElementById('modalObs').style.display = 'flex';
}

window.onclick = function(event) {
    if (event.target.classList.contains('modal-overlay-custom')) {
        event.target.style.display = "none";
    }
}

function filtrarPorStatus(status) {
    filtroStatusAtual = status;
    document.querySelectorAll('.card').forEach(c => c.classList.remove('active'));
    if (status === null) document.getElementById('card-total-box').classList.add('active');
    if (status === 'Agendado') document.getElementById('card-reservado-box').classList.add('active');
    if (status === 'Aguardando') document.getElementById('card-aguardando-box').classList.add('active');
    if (status === 'Não Compareceu') document.getElementById('card-cancelado-box').classList.add('active');
    if (status === 'Atendido') document.getElementById('card-atendido-box').classList.add('active');
    carregarAgendamentos();
}

async function verificarPendencias() {
    try {
        if (userRole !== 'admin' && userRole !== 'recepcao') return;
        
        const response = await fetch('/api/alertas/pendencias', { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await response.json();
        
        const alerta = document.getElementById('alerta-pendencias');
        const texto = document.getElementById('texto-pendencias');

        if (data.pendencias > 0) {
            alerta.style.display = 'flex';
            const datasFormatadas = data.datas.join(', ');
            texto.innerHTML = `<strong>Atenção!</strong> Existem agendamentos pendentes (não finalizados) nos dias: <strong>${datasFormatadas}</strong>. Favor regularizar.`;
        } else {
            alerta.style.display = 'none';
        }
    } catch (error) {
        console.error("Erro pendências:", error);
    }
}

async function carregarAgendamentos() {
    const dataSelecionada = document.getElementById('filtroData').value;
    const termoBusca = document.getElementById('buscaGeral').value.toLowerCase();
    try {
        const response = await fetch(`/api/agendamentos?data=${dataSelecionada}`, {
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
        });
        
        if (response.status === 401 || response.status === 403) { logout(); return; }
        const dados = await response.json();
        const tbody = document.getElementById('tabela-corpo');
        tbody.innerHTML = '';

        let total=0, cReservado=0, cAguardando=0, cAtendido=0, cNaoCompareceu=0;

        dados.forEach(item => {
            const statusNormalizado = item.status || 'Agendado';
            total++;
            if (statusNormalizado === 'Agendado') cReservado++;
            else if (statusNormalizado === 'Aguardando') cAguardando++;
            else if (statusNormalizado === 'Atendido') cAtendido++;
            else if (statusNormalizado === 'Não Compareceu') cNaoCompareceu++;

            if (termoBusca && !item.nome_beneficiario.toLowerCase().includes(termoBusca) && !item.numero_cartao.includes(termoBusca)) return;
            if (filtroStatusAtual && statusNormalizado !== filtroStatusAtual) return;

            const tr = document.createElement('tr');
            let displayNome = item.nome_beneficiario;
            if (item.is_encaixe) {
                displayNome += ` <span class="badge-encaixe" title="Encaixe realizado pela recepção">Encaixe</span>`;
            }
            const classeStatus = statusNormalizado.toLowerCase().replace(/ /g, '-').replace('ã', 'a');
            
            let btnObs = '-';
            if (item.observacao && item.observacao.trim() !== '') {
                btnObs = `<button class="btn-icon btn-obs" onclick="abrirModalObs('${item.observacao.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')" title="Ver Observação">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                          </button>`;
            }

            const podeMudarStatus = ['admin', 'recepcao'].includes(userRole);
            const disabledStatus = podeMudarStatus ? '' : 'disabled';

            let btnCancelar = '';
            if (['admin', 'recepcao', 'call_center'].includes(userRole)) {
                btnCancelar = `<button class="btn-icon btn-cancelar" onclick="abrirModalCancelamento(${item.id})" title="Cancelar Agendamento">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                                 </button>`;
            }

            tr.innerHTML = `
                <td>${item.horario}</td>
                <td>${displayNome}</td>
                <td>${item.numero_cartao}</td>
                <td>${item.contato}</td>
                <td>${item.regiao}</td>
                <td>
                    <select onchange="alterarStatus(${item.id}, this)" class="status-select ${classeStatus}" ${disabledStatus}>
                        <option value="Agendado" ${statusNormalizado === 'Agendado' ? 'selected' : ''}>Reservado</option>
                        <option value="Aguardando" ${statusNormalizado === 'Aguardando' ? 'selected' : ''}>Aguardando</option>
                        <option value="Atendido" ${statusNormalizado === 'Atendido' ? 'selected' : ''}>Atendido</option>
                        <option value="Não Compareceu" ${statusNormalizado === 'Não Compareceu' ? 'selected' : ''}>Não Compareceu</option>
                    </select>
                </td>
                <td>${btnObs}</td>
                <td>${btnCancelar}</td>
            `;
            tbody.appendChild(tr);
        });

        document.getElementById('card-total').innerText = total;
        document.getElementById('card-reservado').innerText = cReservado;
        document.getElementById('card-aguardando').innerText = cAguardando;
        document.getElementById('card-atendido').innerText = cAtendido;
        document.getElementById('card-cancelado').innerText = cNaoCompareceu;
    } catch (error) {
        console.error(error);
        exibirModal('Erro', 'Erro ao carregar dados.');
    }
}
function configurarModalCancelamento() {
    const inputProtocolo = document.getElementById('inputProtocoloCancelamento');
    
    if (inputProtocolo) {
        inputProtocolo.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                const btn = document.getElementById('btnConfirmarCancelamento');
                if (!btn.disabled) {
                    executarCancelamento();
                }
            }
        });
    }
}

async function alterarStatus(id, selectElement) {
    if (userRole !== 'admin' && userRole !== 'recepcao') {
        alert('Você não tem permissão para alterar o status.');
        carregarAgendamentos();
        return;
    }
    
    const novoStatus = selectElement.value;
    const classe = novoStatus.toLowerCase().replace(/ /g, '-').replace('ã', 'a');
    selectElement.className = `status-select ${classe}`;
    try {
        const response = await fetch(`/api/agendamentos/${id}/status`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ status: novoStatus })
        });
        if (!response.ok) throw new Error('Falha');
        carregarAgendamentos();
        if (userRole === 'admin' || userRole === 'recepcao') verificarPendencias();
    } catch (error) {
        exibirModal('Erro', 'Erro ao atualizar status.');
    }
}

document.getElementById('filtroData').addEventListener('change', carregarAgendamentos);
document.getElementById('buscaGeral').addEventListener('keyup', carregarAgendamentos);

let timeoutEncaixe;
const inputEncaixe = document.getElementById('encaixeNome');
const listaEncaixe = document.getElementById('listaSugestoesEncaixe');
const inputCartao = document.getElementById('encaixeCartao');

async function buscarEncaixeApi(forcar = false) {
    const nome = inputEncaixe.value;
    
    if (!forcar && nome.length < 3) {
        listaEncaixe.style.display = 'none';
        return;
    }

    listaEncaixe.style.display = 'block';
    listaEncaixe.innerHTML = '<li>Buscando...</li>';

    try {
        const response = await fetch(`/api/buscar-beneficiario?nome=${encodeURIComponent(nome)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        listaEncaixe.innerHTML = '';
        
        if (data.content && data.content.length > 0) {
            data.content.forEach(p => {
                const li = document.createElement('li');
                const detalhe = p.numeroCartao || p.cpfCnpj || 'Sem ID';
                li.textContent = `${p.nome} (${detalhe})`;
                
                li.onclick = () => {
                    inputEncaixe.value = p.nome;
                    if(inputCartao) inputCartao.value = p.numeroCartao || '';
                    listaEncaixe.style.display = 'none';
                };
                listaEncaixe.appendChild(li);
            });
        } else {
            listaEncaixe.innerHTML = '<li>Nenhum beneficiário encontrado.</li>';
        }
    } catch (e) {
        console.error(e);
        listaEncaixe.innerHTML = '<li>Erro na busca</li>';
    }
}

if (inputEncaixe) {
    inputEncaixe.addEventListener('input', function() {
        clearTimeout(timeoutEncaixe);
        
        if (this.value.length < 3) {
            listaEncaixe.style.display = 'none';
            return;
        }

        timeoutEncaixe = setTimeout(() => {
            buscarEncaixeApi(false);
        }, 600);
    });
}
const inputEncaixeContato = document.getElementById('encaixeContato');

if (inputEncaixeContato) {
    inputEncaixeContato.addEventListener('input', function (e) {
        let x = e.target.value.replace(/\D/g, '').match(/(\d{0,2})(\d{0,1})(\d{0,4})(\d{0,4})/);
        e.target.value = !x[2] ? x[1] : '(' + x[1] + ') ' + x[2] + (x[3] ? ' ' + x[3] : '') + (x[4] ? '-' + x[4] : '');
    });
}

document.addEventListener('click', function(e) {
    if (listaEncaixe && listaEncaixe.style.display === 'block') {
        const btnBusca = document.querySelector('#modalEncaixe button[title="Buscar"]');
        
        if (e.target !== inputEncaixe && 
            !listaEncaixe.contains(e.target) && 
            (!btnBusca || !btnBusca.contains(e.target))) {
            
            listaEncaixe.style.display = 'none';
        }
    }
});
