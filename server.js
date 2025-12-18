require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const admin = require('firebase-admin');

const ADMIN_EMAILS = process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',').map(e => e.trim()) : [];
const RECEPCAO_EMAILS = process.env.RECEPCAO_EMAILS ? process.env.RECEPCAO_EMAILS.split(',').map(e => e.trim()) : [];
const CLIENT_EMAILS = process.env.CLIENT_EMAILS ? process.env.CLIENT_EMAILS.split(',').map(e => e.trim()) : [];

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
        const userEmail = decodedToken.email;

        const isMaida = userEmail.endsWith('@maida.health');
        const isClient = CLIENT_EMAILS.includes(userEmail);

        if (!isMaida && !isClient) {
             return res.status(403).json({ error: 'Domínio/Usuário não autorizado.' });
        }

        let role = 'guest';
        if (ADMIN_EMAILS.includes(userEmail)) role = 'admin';
        else if (RECEPCAO_EMAILS.includes(userEmail)) role = 'recepcao';
        else if (isClient) role = 'cliente';
        else if (isMaida) role = 'call_center';
        
        req.user = { ...decodedToken, role };
        next();
    } catch (error) {
        console.error("Erro Auth:", error);
        return res.status(403).json({ error: 'Token inválido.' });
    }
};

const verificarPermissao = (cargosPermitidos) => {
    return (req, res, next) => {
        const email = req.user.email;
        let cargo = 'indefinido';

        if (ADMIN_EMAILS.includes(email)) {
            cargo = 'admin';
        } else if (RECEPCAO_EMAILS.includes(email)) {
            cargo = 'recepcao';
        } else if (CLIENT_EMAILS.includes(email)) {
            cargo = 'cliente';
        } else if (email.endsWith('@maida.health')) {
            cargo = 'call_center';
        }

        req.user.cargo = cargo;

        if (cargosPermitidos.includes(cargo)) {
            return next();
        }

        return res.status(403).json({ error: 'Acesso negado para seu perfil: ' + cargo });
    };
};

app.get('/api/me', verificarAuth, (req, res) => {
    const email = req.user.email;
    let role = 'guest';

    if (ADMIN_EMAILS.includes(email)) role = 'admin';
    else if (RECEPCAO_EMAILS.includes(email)) role = 'recepcao';
    else if (CLIENT_EMAILS.includes(email)) role = 'cliente';
    else if (email.endsWith('@maida.health')) role = 'call_center';

    res.json({ email, role });
});

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

app.get('/api/buscar-beneficiario', verificarAuth, verificarPermissao(['admin', 'recepcao', 'call_center', 'cliente']), async (req, res) => {
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

app.get('/api/slots-disponiveis', verificarAuth, verificarPermissao(['admin', 'recepcao', 'call_center', 'cliente']), async (req, res) => {
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

app.get('/api/admin/slots', verificarAuth, verificarPermissao(['admin', 'recepcao']), async (req, res) => {
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

app.post('/api/admin/slots', verificarAuth, verificarPermissao(['admin', 'recepcao']), async (req, res) => {
    const { datas, slots } = req.body;

    if (!datas || !Array.isArray(datas) || datas.length === 0 || !slots || slots.length === 0) {
        return res.status(400).json({ error: 'Datas e horários são obrigatórios.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        for (const dataIso of datas) {
            for (const hora of slots) {
                const dataHora = `${dataIso} ${hora}:00`;
                
                await client.query(`
                    INSERT INTO slots (data_hora) 
                    VALUES ($1) 
                    ON CONFLICT (data_hora) DO NOTHING
                `, [dataHora]);
            }
        }

        await client.query('COMMIT');
        res.json({ message: 'Horários criados com sucesso para os dias selecionados.' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Erro criar slots:", error);
        res.status(500).json({ error: 'Erro ao criar horários.' });
    } finally {
        client.release();
    }
});

app.delete('/api/admin/slots/:id', verificarAuth, verificarPermissao(['admin', 'recepcao']), async (req, res) => {
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

app.post('/api/agendar', verificarAuth, verificarPermissao(['admin', 'recepcao', 'call_center']), async (req, res) => {
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

app.get('/api/agendamentos', verificarAuth, verificarPermissao(['admin', 'recepcao', 'call_center', 'cliente']), async (req, res) => {
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
                a.status,
                a.is_encaixe  
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

app.post('/api/encaixe', verificarAuth, verificarPermissao(['admin', 'recepcao']), async (req, res) => {
    const client = await pool.connect();
    const colaborador = req.user.email;
    const { nome, cartao, hora, contato, regiao, obs, force } = req.body;

    const hoje = new Date().toISOString().split('T')[0];
    const dataHoraCompleta = `${hoje} ${hora}:00`;

    try {
        await client.query('BEGIN');

        if (!force) {
            const checkQuery = `
                SELECT to_char(s.data_hora, 'HH24:MI') as hora_existente
                FROM appointments a
                JOIN slots s ON a.slot_id = s.id
                WHERE s.data_hora::date = $1
                AND (
                    (a.numero_cartao = $2 AND a.numero_cartao <> '') 
                    OR 
                    LOWER(a.nome_beneficiario) = LOWER($3)
                )
                AND a.status NOT IN ('Não Compareceu')
            `;
            
            const checkResult = await client.query(checkQuery, [hoje, cartao || '', nome]);

            if (checkResult.rowCount > 0) {
                await client.query('ROLLBACK');
                return res.status(409).json({ 
                    error: 'Duplicidade detectada', 
                    type: 'DUPLICATE_ENTRY',
                    hora: checkResult.rows[0].hora_existente 
                });
            }
        }

        let slotResult = await client.query(
            `INSERT INTO slots (data_hora, disponivel) 
             VALUES ($1, FALSE) 
             ON CONFLICT (data_hora) DO UPDATE SET disponivel = FALSE 
             RETURNING id`,
            [dataHoraCompleta]
        );
        
        const slotId = slotResult.rows[0].id;

        const insertQuery = `
            INSERT INTO appointments 
            (slot_id, nome_beneficiario, numero_cartao, contato, email_contato, regiao, observacao, colaborador_email, status, is_encaixe)
            VALUES ($1, $2, $3, $4, 'encaixe@recepcao', $5, $6, $7, 'Agendado', TRUE) 
            RETURNING id
        `;
        
        await client.query(insertQuery, [slotId, nome, cartao, contato, regiao, obs, colaborador]);
        
        await client.query('COMMIT');
        res.json({ success: true, message: 'Encaixe realizado com sucesso!' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(error);
        res.status(500).json({ error: 'Erro ao realizar encaixe.' });
    } finally {
        client.release();
    }
});

app.delete('/api/agendamentos/:id', verificarAuth, verificarPermissao(['admin', 'recepcao', 'call_center']), async (req, res) => {
    const client = await pool.connect();
    const id = req.params.id;
    const { protocolo } = req.body;
    const quemCancelou = req.user.email;

    if (!protocolo || protocolo.trim() === '') {
        return res.status(400).json({ error: 'O número de protocolo é obrigatório para realizar o cancelamento.' });
    }

    try {
        await client.query('BEGIN');

        const busca = await client.query(`
            SELECT a.nome_beneficiario, a.numero_cartao, a.slot_id, s.data_hora
            FROM appointments a
            JOIN slots s ON a.slot_id = s.id
            WHERE a.id = $1
        `, [id]);
        
        if (busca.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Agendamento não encontrado.' });
        }

        const dadosAgendamento = busca.rows[0];

        await client.query(`
            INSERT INTO cancelamentos (data_hora_agendamento, nome_beneficiario, numero_cartao, quem_cancelou, protocolo)
            VALUES ($1, $2, $3, $4, $5)
        `, [
            dadosAgendamento.data_hora,
            dadosAgendamento.nome_beneficiario,
            dadosAgendamento.numero_cartao,
            quemCancelou,
            protocolo
        ]);

        await client.query('DELETE FROM appointments WHERE id = $1', [id]);

        if (dadosAgendamento.slot_id) {
            await client.query('UPDATE slots SET disponivel = TRUE WHERE id = $1', [dadosAgendamento.slot_id]);
        }

        await client.query('COMMIT');
        res.json({ success: true, message: 'Agendamento cancelado, horário liberado e histórico salvo.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Erro no cancelamento:", error);
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

app.get('/api/relatorios', verificarAuth, verificarPermissao(['admin', 'recepcao', 'call_center', 'cliente']), async (req, res) => {
    const { inicio, fim } = req.query;

    if (!inicio || !fim) {
        return res.status(400).json({ error: 'Datas de início e fim são obrigatórias.' });
    }

    try {
        const query = `
            SELECT 
                to_char(s.data_hora, 'DD/MM/YYYY') as data_formatada,
                to_char(s.data_hora, 'HH24:MI') as hora,
                s.data_hora,
                a.nome_beneficiario,
                a.numero_cartao,
                a.regiao,
                a.status,
                a.is_encaixe,
                a.observacao
            FROM appointments a
            JOIN slots s ON a.slot_id = s.id
            WHERE s.data_hora::date BETWEEN $1 AND $2
            AND a.status IN ('Atendido', 'Não Compareceu')
            ORDER BY s.data_hora ASC
        `;

        const result = await pool.query(query, [inicio, fim]);
        const rows = result.rows;

        const stats = {
            total: rows.length,
            atendidos: rows.filter(r => r.status === 'Atendido').length,
            nao_compareceu: rows.filter(r => r.status === 'Não Compareceu').length,
            regiao: {
                capital: rows.filter(r => r.regiao === 'Capital').length,
                interior: rows.filter(r => r.regiao === 'Interior').length,
                metropolitana: rows.filter(r => r.regiao === 'Metropolitana').length
            },
            lista_detalhada: rows
        };

        res.json(stats);
    } catch (error) {
        console.error("Erro relatorio:", error);
        res.status(500).json({ error: 'Erro ao gerar relatório.' });
    }
});
app.get('/api/dashboard-stats', verificarAuth, verificarPermissao(['admin', 'recepcao', 'cliente']), async (req, res) => {
    const { inicio, fim } = req.query;

    if (!inicio || !fim) {
        return res.status(400).json({ error: 'Datas obrigatórias.' });
    }

    try {
        const queryAgendamentos = `
            SELECT 
                a.status,
                a.is_encaixe,
                a.colaborador_email,
                EXTRACT(DOW FROM s.data_hora) as dia_semana
            FROM appointments a
            JOIN slots s ON a.slot_id = s.id
            WHERE s.data_hora::date BETWEEN $1 AND $2
        `;
        
        const queryCancelamentos = `
            SELECT quem_cancelou 
            FROM cancelamentos 
            WHERE data_cancelamento::date BETWEEN $1 AND $2
        `;
        const queryPericia = `
            SELECT status, EXTRACT(DOW FROM data_registro) as dia_semana
            FROM pericia_documental
            WHERE data_registro::date BETWEEN $1 AND $2
        `;

        const [resultAgendamentos, resultCancelamentos, resultPericia] = await Promise.all([
            pool.query(queryAgendamentos, [inicio, fim]),
            pool.query(queryCancelamentos, [inicio, fim]),
            pool.query(queryPericia, [inicio, fim]) // Executa a nova consulta
        ]);
        

        const agendamentos = resultAgendamentos.rows;
        const cancelamentos = resultCancelamentos.rows;
        const pericias = resultPericia.rows;

        const stats = {
            total: agendamentos.length,
            
            status: {
                atendido: agendamentos.filter(a => a.status === 'Atendido').length,
                nao_compareceu: agendamentos.filter(a => a.status === 'Não Compareceu').length,
                pendente: agendamentos.filter(a => a.status === 'Agendado' || a.status === 'Aguardando').length
            },

            tipo: {
                normal: agendamentos.filter(a => !a.is_encaixe).length,
                encaixe: agendamentos.filter(a => a.is_encaixe).length
            },

            colaboradores_agend: {},
            
            colaboradores_cancel: {},
            pericia: {
                total: pericias.length,
                autorizado: pericias.filter(p => p.status === 'autorizado').length,
                indeferido: pericias.filter(p => p.status === 'indeferido').length,
                parcial: pericias.filter(p => p.status === 'autorizado_parcialmente').length,
                fluxo_semana: [0, 0, 0, 0, 0, 0, 0]
            },
            fluxo_semana: [0, 0, 0, 0, 0, 0, 0] 
        };
        pericias.forEach(p => {
            if (p.dia_semana !== null) {
                stats.pericia.fluxo_semana[Math.floor(p.dia_semana)]++;
            }
        });
        agendamentos.forEach(a => {
            const email = a.colaborador_email || 'Sistema/Desconhecido';
            stats.colaboradores_agend[email] = (stats.colaboradores_agend[email] || 0) + 1;

            if (a.dia_semana !== null) {
                stats.fluxo_semana[Math.floor(a.dia_semana)]++;
            }
        });

        cancelamentos.forEach(c => {
            const email = c.quem_cancelou || 'Sistema';
            stats.colaboradores_cancel[email] = (stats.colaboradores_cancel[email] || 0) + 1;
        });

        res.json(stats);

    } catch (error) {
        console.error("Erro dashboard:", error);
        res.status(500).json({ error: 'Erro ao gerar dados do dashboard.' });
    }
});
app.get('/api/pericia', verificarAuth, verificarPermissao(['admin', 'recepcao']), async (req, res) => {
    const { data } = req.query;
    const dataFiltro = data || new Date().toISOString().split('T')[0];

    try {
        const query = `
            SELECT 
                id,
                nome_beneficiario,
                numero_cartao,
                email_beneficiario,
                status,
                colaborador_email,
                to_char(data_registro, 'HH24:MI') as hora,
                to_char(data_registro, 'DD/MM/YYYY') as data_formatada
            FROM pericia_documental
            WHERE data_registro::date = $1
            ORDER BY data_registro DESC
        `;
        const result = await pool.query(query, [dataFiltro]);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar registros.' });
    }
});

app.post('/api/pericia', verificarAuth, verificarPermissao(['admin', 'recepcao']), async (req, res) => {
    const { nome, cartao, email_beneficiario, status } = req.body;
    const colaborador = req.user.email;

    if (!nome || !status) {
        return res.status(400).json({ error: 'Nome e Status são obrigatórios.' });
    }

    try {
        const query = `
            INSERT INTO pericia_documental 
            (nome_beneficiario, numero_cartao, email_beneficiario, status, colaborador_email)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
        `;
        await pool.query(query, [nome, cartao, email_beneficiario, status, colaborador]);
        
        res.json({ success: true, message: 'Registro salvo com sucesso!' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao salvar registro.' });
    }
});
app.get('/', (req, res) => {
    res.redirect('/html/login.html');
});

app.get('/login', (req, res) => {
    res.redirect('/html/login.html');
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});

module.exports = app;
