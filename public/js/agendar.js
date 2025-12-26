async function verificarAcessoRestrito() {
    const token = localStorage.getItem('maida_token');
    if (!token) window.location.href = 'login.html';

    try {
        const response = await fetch('/api/me', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        
        if (data.role === 'cliente') {
            alert("Acesso não autorizado para este perfil.");
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

    } catch (error) {
        console.error("Erro ao verificar acesso:", error);
    }
}

verificarAcessoRestrito();

function logout() { 
    localStorage.clear(); 
    window.location.href = 'login.html'; 
}

async function iniciarSistema() {
    try {
        const res = await fetch('/api/firebase-config');
        const config = await res.json();
        if (!firebase.apps.length) firebase.initializeApp(config);

        firebase.auth().onAuthStateChanged(user => {
            const overlay = document.getElementById('loading-overlay');
            if (user) {
                overlay.style.display = 'none';
                document.getElementById('atendente').value = user.email;
            } else {
                mostrarAlerta("Sessão Expirada", "Sua sessão expirou. Você será redirecionado para a página inicial.");
                setTimeout(() => window.location.href = 'index.html', 2000);
            }
        });
    } catch (error) {
        console.error(error);
        mostrarAlerta("Erro de Conexão", "Erro ao conectar com o servidor.");
    }
}
iniciarSistema();

async function getAuthHeaders() {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error("Usuário não logado");
    const token = await user.getIdToken();
    return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };
}
function abrirModalSucesso(nome, dataRaw, hora) {
    const partes = dataRaw.split('-');
    const dataFormatada = `${partes[2]}/${partes[1]}/${partes[0]}`;

    const textoFinal = `Beneficiário: ${nome} agendado para: ${dataFormatada} horário: ${hora}`;
    
    document.getElementById('texto-para-copiar').innerText = textoFinal;
    
    document.getElementById('modal-sucesso-copy').style.display = 'flex';
}

function fecharModalSucesso() {
    window.location.reload();
}

function copiarTextoAgendamento() {
    const texto = document.getElementById('texto-para-copiar').innerText;
    
    navigator.clipboard.writeText(texto).then(() => {
        const btn = document.querySelector('.btn-action-copy');
        const htmlOriginal = btn.innerHTML;
        
        btn.innerHTML = 'Copiado!';
        btn.classList.add('copiado');
        
        setTimeout(() => {
            btn.innerHTML = htmlOriginal;
            btn.classList.remove('copiado');
        }, 2000);
    }).catch(err => {
        console.error('Erro ao copiar:', err);
    });
}
function abrirModal(modalId) {
    document.getElementById(modalId).style.display = 'flex';
}

function fecharModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

function mostrarAlerta(titulo, mensagem) {
    document.getElementById('modal-alert-titulo').innerText = titulo;
    document.getElementById('modal-alert-texto').innerText = mensagem;
    abrirModal('modal-alert');
}

function mostrarConfirmacao(mensagem, callback) {
    document.getElementById('modal-confirm-texto').innerText = mensagem;
    window.confirmacaoCallback = callback;
    abrirModal('modal-confirm');
}

function executarAcaoConfirmada() {
    fecharModal('modal-confirm');
    if (window.confirmacaoCallback) {
        window.confirmacaoCallback();
        window.confirmacaoCallback = null;
    }
}

window.onclick = function(event) {
    if (event.target.classList.contains('modal-overlay')) {
        if (event.target.id === 'modal-sucesso-copy') {
            return; 
        }
        event.target.style.display = 'none';
    }
}

document.getElementById('filtroData').addEventListener('change', async function() {
    const data = this.value;
    const container = document.getElementById('container-horarios');
    const inputId = document.getElementById('slotIdSelecionado');
    
    inputId.value = '';

    if (!data) {
        container.innerHTML = '<p>Selecione uma data acima.</p>';
        return;
    }

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const partesData = data.split('-');
    const dataSelecionada = new Date(partesData[0], partesData[1] - 1, partesData[2]);

    if (dataSelecionada <= hoje) {
        mostrarAlerta("Data Inválida", "Agendamentos permitidos apenas a partir de amanhã.");
        this.value = '';
        container.innerHTML = '<p>Selecione uma data futura (a partir de amanhã).</p>';
        return;
    }

    container.innerHTML = 'Carregando...';
    
    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`/api/slots-disponiveis?data=${data}`, { headers });
        const horarios = await response.json();
        container.innerHTML = '';
        if (horarios.length === 0) { 
            container.innerHTML = '<p>Nenhum horário livre.</p>'; 
            return; 
        }
        horarios.forEach(slot => {
            const btn = document.createElement('div');
            btn.className = 'btn-horario';
            btn.textContent = slot.hora;
            btn.onclick = () => {
                document.querySelectorAll('.btn-horario').forEach(b => b.classList.remove('selecionado'));
                btn.classList.add('selecionado');
                inputId.value = slot.id;
            };
            container.appendChild(btn);
        });
    } catch (error) { 
        container.innerHTML = '<p style="color:red">Erro ao buscar horários.</p>'; 
    }
});

const inputBusca = document.getElementById('buscaNome');
const listaSugestoes = document.getElementById('listaSugestoes');
let timeoutDigitacao;

async function buscarNaApi(termo) {
    if (termo.length < 3) return;
    listaSugestoes.innerHTML = '<li>Buscando...</li>';
    listaSugestoes.style.display = 'block';
    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`/api/buscar-beneficiario?nome=${encodeURIComponent(termo)}`, { headers });
        const data = await response.json();
        listaSugestoes.innerHTML = '';
        if (data.content && data.content.length > 0) {
            data.content.forEach(pessoa => {
                const li = document.createElement('li');
                const detalhe = pessoa.numeroCartao || pessoa.cpfCnpj || 'Sem ID';
                li.textContent = `${pessoa.nome} (${detalhe})`;
                li.onclick = () => {
                    inputBusca.value = pessoa.nome;
                    document.getElementById('numCartao').value = pessoa.numeroCartao || '';
                    listaSugestoes.style.display = 'none';
                };
                listaSugestoes.appendChild(li);
            });
        } else { 
            listaSugestoes.innerHTML = '<li>Nenhum beneficiário encontrado.</li>'; 
        }
    } catch (error) { 
        listaSugestoes.innerHTML = '<li>Erro na conexão.</li>'; 
    }
}

inputBusca.addEventListener('input', function() {
    clearTimeout(timeoutDigitacao);
    if (this.value.length < 3) { 
        listaSugestoes.style.display = 'none'; 
        return; 
    }
    timeoutDigitacao = setTimeout(() => buscarNaApi(this.value), 600);
});

function executarBuscaManual() {
    const termo = inputBusca.value;
    if(!termo) return mostrarAlerta("Campo Vazio", "Digite um nome ou CPF.");
    buscarNaApi(termo);
}

document.addEventListener('click', function(e) {
    if (e.target !== inputBusca && e.target !== listaSugestoes && e.target.className !== 'btn-buscar') listaSugestoes.style.display = 'none';
});

async function salvarAgendamento() {
    const slotId = document.getElementById('slotIdSelecionado').value;
    const nome = document.getElementById('buscaNome').value;
    const cartao = document.getElementById('numCartao').value;
    const emailInput = document.getElementById('email').value;
    const contatoInput = document.getElementById('contato').value;
    const regiaoInput = document.getElementById('regiao').value;
    const user = firebase.auth().currentUser;

    if (!user) return mostrarAlerta("Sessão Perdida", "Sua sessão expirou. Faça login novamente.");
    if (!slotId) return mostrarAlerta("Horário Não Selecionado", "Selecione um horário disponível.");
    if (!nome || !cartao) return mostrarAlerta("Beneficiário Inválido", "Preencha os dados do beneficiário corretamente.");
    const regexTelefone = /^\(\d{2}\) \d \d{4}-\d{4}$/;
    if (!contatoInput) return mostrarAlerta("Telefone Obrigatório", "Preencha o telefone do beneficiário.");
    if (!regexTelefone.test(contatoInput)) {
        return mostrarAlerta("Formato Inválido", "Digite o telefone no formato: (99) 9 9999-9999");
    }
    try {
        const headers = await getAuthHeaders();
        
        const resDuplicidade = await fetch(`/api/agendamentos`, { headers });
        const todosAgendamentos = await resDuplicidade.json();

        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);

        const conflitoFuturo = todosAgendamentos.find(ag => {
            const dataAgendamento = new Date(ag.data_hora);
            return (ag.numero_cartao === cartao) && (dataAgendamento >= hoje);
        });

        let mensagemConfirmacao = "Confirmar Agendamento?";
        
        if (conflitoFuturo) {
            mensagemConfirmacao = `O paciente ${conflitoFuturo.nome_beneficiario} já possui um agendamento no dia ${conflitoFuturo.data_formatada} às ${conflitoFuturo.horario}. Deseja marcar este novo horário mesmo assim?`;
        }

        mostrarConfirmacao(mensagemConfirmacao, async function() {
            const payload = {
                slot_id: slotId,
                nome: nome,
                cartao: cartao,
                contato: contatoInput,
                email: emailInput,
                regiao: document.getElementById('regiao').value,
                obs: document.getElementById('obs').value,
                colaborador: user.email
            };

            try {
                const response = await fetch('/api/agendar', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(payload)
                });
                
                if (response.ok) {
                    fecharModal('modal-confirm');

                    const dataInput = document.getElementById('filtroData').value;
                    
                    const btnHorario = document.querySelector('.btn-horario.selecionado');
                    const horaTexto = btnHorario ? btnHorario.textContent : 'Horário não identificado';

                    abrirModalSucesso(nome, dataInput, horaTexto);
                    
                } else {
                    const erro = await response.json();
                    mostrarAlerta("Erro no Agendamento", 'Erro: ' + (erro.error || 'Falha ao agendar'));
                }
            } catch (error) {
                mostrarAlerta("Erro de Conexão", 'Erro ao conectar com o servidor.');
            }
        });

    } catch (error) {
        console.error(error);
        mostrarAlerta("Erro", "Falha ao verificar histórico de agendamentos.");
    }
}
const inputTelefone = document.getElementById('contato');

if (inputTelefone) {
    inputTelefone.addEventListener('input', function (e) {
        let x = e.target.value.replace(/\D/g, '').match(/(\d{0,2})(\d{0,1})(\d{0,4})(\d{0,4})/);
        e.target.value = !x[2] ? x[1] : '(' + x[1] + ') ' + x[2] + (x[3] ? ' ' + x[3] : '') + (x[4] ? '-' + x[4] : '');
    });
}
