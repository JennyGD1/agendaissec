const token = localStorage.getItem('maida_token');
let userRole = 'guest';
let timeoutBusca;

async function iniciarFirebase() {
    try {
        const res = await fetch('/api/firebase-config');
        const config = await res.json();
        if (!firebase.apps.length) firebase.initializeApp(config);
    } catch (error) {
        console.error("Erro Firebase", error);
    }
}
iniciarFirebase();

if (!token) {
    window.location.href = 'login.html';
} else {
    document.getElementById('filtroData').value = new Date().toISOString().split('T')[0];
    checarPermissoes();
}

async function checarPermissoes() {
    try {
        const response = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${token}` } });
        if (!response.ok) throw new Error('Falha auth');
        const data = await response.json();
        userRole = data.role;
        
        carregarPericias();
    } catch (error) {
        logout();
    }
}

function logout() {
    localStorage.clear();
    window.location.href = 'login.html';
}

async function carregarPericias() {
    const data = document.getElementById('filtroData').value;
    const termo = document.getElementById('buscaPericia').value.toLowerCase();
    
    try {
        const res = await fetch(`/api/pericia?data=${data}`, { headers: { 'Authorization': `Bearer ${token}` } });
        const lista = await res.json();
        
        const tbody = document.getElementById('tabela-corpo');
        tbody.innerHTML = '';

        lista.forEach(item => {
            if (termo && !item.nome_beneficiario.toLowerCase().includes(termo) && !item.numero_cartao.includes(termo)) return;

            const tr = document.createElement('tr');
            
            // Tratamento visual do status
            let statusClass = item.status; 
            let statusLabel = item.status.replace('_', ' '); // Tira underline

            tr.innerHTML = `
                <td>${item.hora}</td>
                <td>${item.nome_beneficiario}</td>
                <td>${item.numero_cartao || '-'}</td>
                <td>${item.email_beneficiario || '-'}</td>
                <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
                <td>${item.colaborador_email}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error(e);
        exibirModal('Erro', 'Falha ao carregar registros.');
    }
}

document.getElementById('filtroData').addEventListener('change', carregarPericias);
document.getElementById('buscaPericia').addEventListener('keyup', carregarPericias);

function abrirModalRegistro() {
    document.getElementById('regNome').value = '';
    document.getElementById('regCartao').value = '';
    document.getElementById('regEmail').value = '';
    document.getElementById('regStatus').value = '';
    document.getElementById('listaSugestoes').style.display = 'none';
    document.getElementById('modalRegistro').style.display = 'flex';
}

async function salvarRegistro() {
    const nome = document.getElementById('regNome').value;
    const cartao = document.getElementById('regCartao').value;
    const email = document.getElementById('regEmail').value;
    const status = document.getElementById('regStatus').value;
    const btn = document.getElementById('btnSalvarRegistro');

    if (!nome || !status) {
        return exibirModal('Atenção', 'Preencha Nome e Status.');
    }

    btn.innerText = 'Salvando...';
    btn.disabled = true;

    try {
        const payload = { nome, cartao, email_beneficiario: email, status };
        
        const res = await fetch('/api/pericia', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            exibirModal('Sucesso', 'Registro salvo com sucesso!');
            fecharModal('modalRegistro');
            carregarPericias();
        } else {
            const err = await res.json();
            exibirModal('Erro', err.error || 'Erro ao salvar.');
        }
    } catch (e) {
        exibirModal('Erro', 'Erro de conexão.');
    } finally {
        btn.innerText = 'Salvar Registro';
        btn.disabled = false;
    }
}

const inputNome = document.getElementById('regNome');
const listaSugestoes = document.getElementById('listaSugestoes');

async function buscarBeneficiarioApi(forcar = false) {
    const nome = inputNome.value;
    if (!forcar && nome.length < 3) {
        listaSugestoes.style.display = 'none';
        return;
    }

    listaSugestoes.style.display = 'block';
    listaSugestoes.innerHTML = '<li>Buscando...</li>';

    try {
        const res = await fetch(`/api/buscar-beneficiario?nome=${encodeURIComponent(nome)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        listaSugestoes.innerHTML = '';

        if (data.content && data.content.length > 0) {
            data.content.forEach(p => {
                const li = document.createElement('li');
                li.innerHTML = `<strong>${p.nome}</strong><br><small>${p.numeroCartao || 'S/ Cartão'}</small>`;
                li.onclick = () => {
                    inputNome.value = p.nome;
                    document.getElementById('regCartao').value = p.numeroCartao || '';
                    if(p.email) document.getElementById('regEmail').value = p.email;
                    listaSugestoes.style.display = 'none';
                };
                listaSugestoes.appendChild(li);
            });
        } else {
            listaSugestoes.innerHTML = '<li>Nenhum encontrado</li>';
        }
    } catch (e) {
        listaSugestoes.innerHTML = '<li>Erro na busca</li>';
    }
}

inputNome.addEventListener('input', function() {
    clearTimeout(timeoutBusca);
    if (this.value.length < 3) {
        listaSugestoes.style.display = 'none';
        return;
    }
    timeoutBusca = setTimeout(() => buscarBeneficiarioApi(false), 600);
});

document.addEventListener('click', function(e) {
    if (!listaSugestoes.contains(e.target) && e.target !== inputNome) {
        listaSugestoes.style.display = 'none';
    }
});

function exibirModal(titulo, mensagem) {
    document.getElementById('modalTitulo').innerText = titulo;
    document.getElementById('modalMensagem').innerText = mensagem;
    
    const btnContainer = document.getElementById('modalBotoes');
    btnContainer.innerHTML = '';
    
    const btnOk = document.createElement('button');
    btnOk.className = 'btn-modal-custom btn-confirm-custom';
    btnOk.innerText = 'OK';
    btnOk.onclick = () => fecharModal('modalSistema');
    btnContainer.appendChild(btnOk);

    document.getElementById('modalSistema').style.zIndex = '9999';
    document.getElementById('modalSistema').style.display = 'flex';
}

function fecharModal(id) {
    document.getElementById(id).style.display = 'none';
}
