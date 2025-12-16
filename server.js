require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const admin = require('firebase-admin');

try {
    if (process.env.FIREBASE_PRIVATE_KEY) {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
            })
        });
    }
} catch (error) {
    console.error("Erro Firebase:", error.message);
}

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/favicon.ico', (req, res) => res.status(204));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const verificarAuth = async (req, res, next) => {
    if (!admin.apps.length) return next();

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token não fornecido.' });
    }

    try {
        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        
        if (!decodedToken.email.endsWith('@maida.health')) {
             return res.status(403).json({ error: 'Domínio não autorizado.' });
        }

        const userEmail = decodedToken.email;
        let role = 'geral';
        
        const adminEmails = process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',') : [];
        const recepcaoEmails = process.env.RECEPCAO_EMAILS ? process.env.RECEPCAO_EMAILS.split(',') : [];
        
        if (adminEmails.includes(userEmail)) {
            role = 'admin';
        } else if (recepcaoEmails.includes(userEmail)) {
            role = 'recepcao';
        }
        
        req.user = { ...decodedToken, role };
        next();
    } catch (error) {
        console.error("Erro Auth:", error);
        return res.status(403).json({ error: 'Token inválido.' });
    }
};

const verificarPermissao = (rolesPermitidos) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Usuário não autenticado.' });
        }
        
        if (rolesPermitidos.includes(req.user.role)) {
            next();
        } else {
            res.status(403).json({ error: 'Acesso não autorizado para este perfil.' });
        }
    };
};

app.get('/api/firebase-config', (req, res) => {
    res.json({
        apiKey: process.env.PUBLIC_FIREBASE_API_KEY,
        authDomain: process.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: process.env.PUBLIC_FIREBASE_PROJECT_ID,
        storageBucket: process.env.PUBLIC_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.PUBLIC_FIREBASE_APP_ID
    });
});

async function obterTokenIssec() {
    try {
        const urlAppScript = process.env.GAS_TOKEN_URL;
        if (!urlAppScript) throw new Error("GAS_TOKEN_URL não definido no .env");

        const response = await axios.get(urlAppScript);
        const dados = response.data;

        let tokenFinal = '';
        if (typeof dados === 'object' && dados.token) {
            tokenFinal = dados.token;
        } else if (typeof dados === 'string') {
            tokenFinal = dados;
        }

        if (!tokenFinal || tokenFinal.length < 20) {
            throw new Error("Token não encontrado ou inválido na resposta.");
        }

        return tokenFinal;
    } catch (error) {
        console.error("Erro ao obter token do AppScript:", error.message);
        throw error;
    }
}

app.get('/api/user-role', verificarAuth, (req, res) => {
    res.json({ role: req.user.role, email: req.user.email });
});

app.get('/api/buscar-beneficiario', verificarAuth, verificarPermissao(['admin', 'recepcao', 'geral']), async (req, res) => {
    const nomeBusca = req.query.nome;

    if (!nomeBusca) {
        return res.status(400).json({ error: 'Nome é obrigatório.' });
    }

    try {
        const tokenAtualizado = await obterTokenIssec();
        const url = `${process.env.API_MAIDA_URL}/buscar/segurados`;
        
        const response = await axios.get(url, {
            params: { page: 0, size: 10, elegivel: true, nomeCpf: nomeBusca },
            headers: { 'Authorization': `Bearer ${tokenAtualizado}`, 'Content-Type': 'application/json' }
        });

        res.json(response.data);
    } catch (error) {
        if (error.response) {
            res.status(error.response.status).json({ error: 'Erro na API externa.' });
        } else {
            res.status(500).json({ error: 'Erro ao processar busca.' });
        }
    }
});

app.get('/api/slots-disponiveis', verificarAuth, verificarPermissao(['admin', 'recepcao', 'geral']), async (req, res) => {
    const { data } = req.query;
    if (!data) return res.status(400).json({ error: 'Data obrigatória.' });

    try {
        const query = `
            SELECT id, to_char(data_hora, 'HH24:MI') as hora 
            FROM slots 
            WHERE disponivel = TRUE AND data_hora::date = $1
            ORDER BY data_hora ASC
        `;
        const result = await pool.query(query, [data]);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar slots.' });
    }
});

app.get('/api/admin/slots', verificarAuth, verificarPermissao(['admin']), async (req, res) => {
    const { data } = req.query;
    if (!data) return res.status(400).json({ error: 'Data obrigatória.' });

    try {
        const query = `
            SELECT id, to_char(data_hora, 'HH24:MI') as hora, disponivel 
            FROM slots WHERE data_hora::date = $1
            ORDER BY data_hora ASC
        `;
        const result = await pool.query(query, [data]);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar slots do admin.' });
    }
});

app.post('/api/admin/criar-horarios', verificarAuth, verificarPermissao(['admin']), async (req, res) => {
    const { data, horarios } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        for (const hora of horarios) {
            const dataHoraFormatada = `${data} ${hora}:00`;
            await client.query(
                'INSERT INTO slots (data_hora, disponivel) VALUES ($1, TRUE) ON CONFLICT DO NOTHING',
                [dataHoraFormatada]
            );
        }
        await client.query('COMMIT');
        res.json({ success: true, message: 'Horários criados!' });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Erro ao criar horários: ' + error.message });
    } finally {
        client.release();
    }
});

app.delete('/api/admin/slots/:id', verificarAuth, verificarPermissao(['admin']), async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        const check = await client.query('SELECT id FROM appointments WHERE slot_id = $1', [id]);
        
        if (check.rowCount > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Não é possível excluir: Existe um agendamento neste horário.' });
        }

        await client.query('DELETE FROM slots WHERE id = $1', [id]);
        await client.query('COMMIT');
        res.json({ success: true, message: 'Horário excluído com sucesso.' });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Erro ao excluir horário.' });
    } finally {
        client.release();
    }
});

app.post('/api/agendar', verificarAuth, verificarPermissao(['admin', 'recepcao', 'geral']), async (req, res) => {
    const client = await pool.connect();
    const colaborador = req.user ? req.user.email : req.body.colaborador;
    const { slot_id, nome, cartao, contato, email, regiao, obs } = req.body;

    try {
        await client.query('BEGIN');
        const slotUpdate = await client.query(
            'UPDATE slots SET disponivel = FALSE WHERE id = $1 AND disponivel = TRUE RETURNING id',
            [slot_id]
        );

        if (slotUpdate.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Horário indisponível ou inexistente.' });
        }

        const insertQuery = `
            INSERT INTO appointments 
            (slot_id, nome_beneficiario, numero_cartao, contato, email_contato, regiao, observacao, colaborador_email, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Agendado') RETURNING id
        `;
        
        await client.query(insertQuery, [slot_id, nome, cartao, contato, email, regiao, obs, colaborador]);
        await client.query('COMMIT');
        res.json({ success: true, message: 'Agendamento realizado!' });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Erro ao processar agendamento.' });
    } finally {
        client.release();
    }
});

app.get('/api/agendamentos', verificarAuth, verificarPermissao(['admin', 'recepcao', 'geral']), async (req, res) => {
    const { data } = req.query;
    try {
        let query = `
            SELECT 
                a.id, 
                to_char(s.data_hora, 'HH24:MI') as horario,
                to_char(s.data_hora, 'DD/MM/YYYY') as data_formatada,
                s.data_hora,
                a.nome_beneficiario, 
                a.numero_cartao, 
                a.contato, 
                a.observacao, 
                a.regiao, 
                a.colaborador_email, 
                a.status 
            FROM appointments a
            JOIN slots s ON a.slot_id = s.id
        `;

        const params = [];
        if (data) {
            query += ` WHERE s.data_hora::date = $1`;
            params.push(data);
        }

        query += ` ORDER BY s.data_hora ASC`;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar agendamentos.' });
    }
});

app.delete('/api/agendamentos/:id', verificarAuth, verificarPermissao(['admin', 'recepcao']), async (req, res) => {
    const client = await pool.connect();
    const id = req.params.id;

    try {
        await client.query('BEGIN');
        const busca = await client.query('SELECT slot_id FROM appointments WHERE id = $1', [id]);
        
        if (busca.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Agendamento não encontrado.' });
        }

        const slotId = busca.rows[0].slot_id;
        await client.query('DELETE FROM appointments WHERE id = $1', [id]);

        if (slotId) {
            await client.query('UPDATE slots SET disponivel = TRUE WHERE id = $1', [slotId]);
        }

        await client.query('COMMIT');
        res.json({ success: true, message: 'Agendamento cancelado e horário liberado.' });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Erro ao processar cancelamento.' });
    } finally {
        client.release();
    }
});

app.patch('/api/agendamentos/:id/status', verificarAuth, verificarPermissao(['admin', 'recepcao']), async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!['Agendado', 'Aguardando', 'Atendido', 'Não Compareceu'].includes(status)) {
        return res.status(400).json({ error: 'Status inválido.' });
    }

    try {
        await pool.query('UPDATE appointments SET status = $1 WHERE id = $2', [status, id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao atualizar status.' });
    }
});

app.get('/api/alertas/pendencias', verificarAuth, verificarPermissao(['admin', 'recepcao']), async (req, res) => {
    try {
        const query = `
            SELECT to_char(s.data_hora, 'DD/MM/YYYY') as data_pendente
            FROM appointments a
            JOIN slots s ON a.slot_id = s.id
            WHERE s.data_hora::date < CURRENT_DATE 
            AND a.status NOT IN ('Atendido', 'Não Compareceu')
            GROUP BY data_pendente
            ORDER BY min(s.data_hora) ASC
        `;
        const result = await pool.query(query);
        const datas = result.rows.map(r => r.data_pendente);
        
        res.json({ 
            pendencias: datas.length, 
            datas: datas 
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao verificar pendências.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
module.exports = app;