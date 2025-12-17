// --- SISTEMA DE MODAIS ---
function exibirModal(titulo, mensagem) {
    const modal = document.getElementById('modalSistema');
    document.getElementById('modalTitulo').innerText = titulo || 'Aviso';
    document.getElementById('modalMensagem').innerText = mensagem;
    const btnContainer = document.getElementById('modalBotoes');
    btnContainer.innerHTML = '<button class="btn-modal-custom btn-confirm-custom" onclick="fecharModal()">OK</button>';
    modal.style.display = 'flex';
}

function fecharModal() {
    document.getElementById('modalSistema').style.display = 'none';
}

window.onclick = function(event) {
    const modal = document.getElementById('modalSistema');
    if (event.target == modal) {
        fecharModal();
    }
}

// --- FIREBASE E LOGIN ---
async function iniciarFirebase() {
    try {
        const res = await fetch('/api/firebase-config');
        const config = await res.json();
        if (!firebase.apps.length) {
            firebase.initializeApp(config);
        }

        // Verifica se já está logado
        firebase.auth().onAuthStateChanged(async (user) => {
            if (user) {
                await salvarTokenERedirecionar(user);
            }
        });

    } catch (error) {
        console.error("Erro ao carregar config:", error);
        exibirModal('Erro', "Erro ao conectar com o servidor de autenticação.");
    }
}

// Inicia o Firebase quando o script carrega
document.addEventListener('DOMContentLoaded', iniciarFirebase);

function fazerLoginGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    // Força a seleção de conta para evitar login automático indesejado
    provider.setCustomParameters({
        prompt: 'select_account'
    });
    
    document.getElementById('loading-overlay').style.display = 'flex';

    firebase.auth().signInWithPopup(provider)
        .then(async (result) => {
            await salvarTokenERedirecionar(result.user);
        })
        .catch((error) => {
            document.getElementById('loading-overlay').style.display = 'none';
            console.error("Erro no login:", error);
            exibirModal('Falha no Login', "Não foi possível autenticar com o Google. Tente novamente.");
        });
}

async function salvarTokenERedirecionar(user) {
    try {
        const token = await user.getIdToken();
        localStorage.setItem('maida_token', token);
        localStorage.setItem('maida_user_name', user.displayName || user.email);
        
        window.location.href = 'index.html';
    } catch (error) {
        document.getElementById('loading-overlay').style.display = 'none';
        console.error("Erro ao obter token:", error);
        exibirModal('Erro', "Falha ao processar credenciais.");
    }
}