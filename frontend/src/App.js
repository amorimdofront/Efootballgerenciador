import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import Auth from './Auth';

function App() {
  // --- ESTADOS GERAIS ---
  const [view, setView] = useState('home'); 
  const [activeTab, setActiveTab] = useState('confrontos'); 
  const [user, setUser] = useState(null);

  // --- ESTADOS DO CAMPEONATO ---
  const [campeonatos, setCampeonatos] = useState([]);
  const [campeonatoAtivo, setCampeonatoAtivo] = useState(null);
  const [times, setTimes] = useState([]);
  const [partidas, setPartidas] = useState([]);
  const [admins, setAdmins] = useState([]);
  
  // --- ESTADOS DE FORMULÁRIOS ---
  const [nome, setNome] = useState('');
  const [formato, setFormato] = useState('pontos-corridos');
  const [qtdTimes, setQtdTimes] = useState(16);
  const [nomeTime, setNomeTime] = useState('');
  const [nomeResponsavel, setNomeResponsavel] = useState('');
  const [escudoFile, setEscudoFile] = useState(null); 
  const [uploading, setUploading] = useState(false);
  const [novoAdminEmail, setNovoAdminEmail] = useState('');

  // --- AUTENTICAÇÃO ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  // --- CARREGAMENTO DE DADOS ---
  const carregarCampeonatos = async () => {
    const { data } = await supabase.from('campeonatos').select('*').order('created_at', { ascending: false });
    if (data) setCampeonatos(data);
  };

  useEffect(() => { carregarCampeonatos(); }, [user]);

  const carregarDadosCampeonato = async (champ) => {
    setCampeonatoAtivo(champ);
    // Times
    const { data: t } = await supabase.from('times').select('*').eq('campeonato_id', champ.id).order('created_at', { ascending: true });
    if (t) setTimes(t);
    // Partidas com Join para pegar escudos e nomes
    const { data: p } = await supabase.from('partidas')
      .select(`*, time_casa:time_casa_id(nome, escudo_url), time_fora:time_fora_id(nome, escudo_url)`)
      .eq('campeonato_id', champ.id)
      .order('id', { ascending: true });
    if (p) setPartidas(p);
    // Admins
    const { data: a } = await supabase.from('administradores').select('*').eq('campeonato_id', champ.id);
    if (a) setAdmins(a);
    
    setView('detalhes');
  };

  // --- LÓGICA DE PLACAR E CLASSIFICAÇÃO ---
  const salvarNoBanco = useCallback(async (id, gc, gf) => {
    await supabase.from('partidas').update({ gols_casa: gc, gols_fora: gf, status: 'finalizado' }).eq('id', id);
  }, []);

  const mudarPlacarLocal = (id, campo, valor) => {
    const numValue = parseInt(valor) || 0;
    const novasPartidas = partidas.map(p => {
      if (p.id === id) {
        const updated = { ...p, [campo]: numValue, status: 'finalizado' };
        salvarNoBanco(id, campo === 'gols_casa' ? numValue : p.gols_casa, campo === 'gols_fora' ? numValue : p.gols_fora);
        return updated;
      }
      return p;
    });
    setPartidas(novasPartidas);
  };

  const calcularClassificacao = () => {
    const tabela = times.map(time => {
      let s = { ...time, p: 0, j: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0, sg: 0 };
      partidas.filter(m => m.status === 'finalizado').forEach(m => {
        if (m.time_casa_id === time.id) {
          s.j++; s.gp += m.gols_casa; s.gc += m.gols_fora;
          if (m.gols_casa > m.gols_fora) { s.v++; s.p += 3; }
          else if (m.gols_casa === m.gols_fora) { s.e++; s.p += 1; }
          else s.d++;
        } else if (m.time_fora_id === time.id) {
          s.j++; s.gp += m.gols_fora; s.gc += m.gols_casa;
          if (m.gols_fora > m.gols_casa) { s.v++; s.p += 3; }
          else if (m.gols_casa === m.gols_fora) { s.e++; s.p += 1; }
          else s.d++;
        }
      });
      s.sg = s.gp - s.gc;
      return s;
    });
    return tabela.sort((a, b) => b.p - a.p || b.sg - a.sg);
  };

  // --- AÇÕES DO BANCO ---
  const criarCampeonatoReal = async (e) => {
    e.preventDefault();
    if (!user) return;
    const { error } = await supabase.from('campeonatos').insert([{ nome, formato, qtd_times: parseInt(qtdTimes), criador_id: user.id }]);
    if (!error) { setNome(''); carregarCampeonatos(); setView('home'); }
  };

  const adicionarTimeCompleto = async (e) => {
    e.preventDefault();
    setUploading(true);
    let escudoUrl = null;

    if (escudoFile) {
      const fileName = `${user.id}-${Date.now()}.${escudoFile.name.split('.').pop()}`;
      const { error: upErr } = await supabase.storage.from('escudos').upload(fileName, escudoFile);
      if (!upErr) {
        const { data: pUrl } = supabase.storage.from('escudos').getPublicUrl(fileName);
        escudoUrl = pUrl.publicUrl;
      }
    }

    await supabase.from('times').insert([{ 
      campeonato_id: campeonatoAtivo.id, 
      nome: nomeTime, 
      jogador_responsavel: nomeResponsavel, 
      escudo_url: escudoUrl 
    }]);

    setNomeTime(''); setNomeResponsavel(''); setEscudoFile(null);
    setUploading(false);
    carregarDadosCampeonato(campeonatoAtivo);
  };

  const gerarTabelaJogos = async () => {
    // 1. Limpa jogos existentes caso o usuário esteja regerando
    await supabase.from('partidas').delete().eq('campeonato_id', campeonatoAtivo.id);

    let ts = [...times];
    if (ts.length % 2 !== 0) ts.push({ id: null, nome: 'FOLGA' });
    
    const rounds = ts.length - 1;
    const half = ts.length / 2;
    const matches = [];

    for (let r = 1; r <= rounds; r++) {
      for (let i = 0; i < half; i++) {
        const casa = ts[i]; 
        const fora = ts[ts.length - 1 - i];
        if (casa.id && fora.id) {
          matches.push({ 
            campeonato_id: campeonatoAtivo.id, 
            time_casa_id: casa.id, 
            time_fora_id: fora.id, 
            rodada: r, 
            status: 'agendado',
            gols_casa: 0,
            gols_fora: 0
          });
        }
      }
      ts.splice(1, 0, ts.pop());
    }

    await supabase.from('partidas').insert(matches);
    carregarDadosCampeonato(campeonatoAtivo);
  };

  const canEdit = (user && campeonatoAtivo && user.id === campeonatoAtivo.criador_id) || (user && admins.some(a => a.user_email === user.email.toLowerCase()));
  const isOwner = user && campeonatoAtivo && user.id === campeonatoAtivo.criador_id;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans">
      {/* HEADER */}
      <nav className="border-b border-gray-800 p-4 flex justify-between items-center bg-[#111] sticky top-0 z-50">
        <h1 className="text-2xl font-bold italic text-[#00ff85] cursor-pointer" onClick={() => setView('home')}>eFOOTBALL CHAMP</h1>
        <div className="flex items-center gap-4">
           {user ? <button onClick={() => supabase.auth.signOut()} className="text-red-500 text-xs font-bold uppercase">Sair</button> : <button onClick={() => setView('login')} className="bg-[#00ff85] text-black px-4 py-2 rounded-full font-bold text-xs uppercase">Entrar</button>}
        </div>
      </nav>

      <main className="p-6 max-w-7xl mx-auto">
        {view === 'login' && <Auth onLogin={() => { setView('home'); carregarCampeonatos(); }} />}

        {/* LISTA DE CAMPEONATOS */}
        {view === 'home' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {campeonatos.map(c => (
              <div key={c.id} className="bg-[#111] p-6 rounded-2xl border border-gray-800 flex flex-col justify-between h-44 hover:border-[#00ff85] transition">
                <h3 className="text-xl font-bold italic uppercase text-[#00ff85]">{c.nome}</h3>
                <button onClick={() => carregarDadosCampeonato(c)} className="mt-6 w-full py-2 bg-gray-800 text-white font-bold rounded-lg hover:bg-[#00ff85] hover:text-black transition uppercase text-sm">Gerenciar</button>
              </div>
            ))}
            <div onClick={() => user ? setView('criar') : setView('login')} className="border-2 border-dashed border-gray-800 p-6 rounded-2xl flex items-center justify-center text-gray-500 cursor-pointer h-44 font-black italic hover:border-[#00ff85] transition">+ Novo Torneio</div>
          </div>
        )}

        {/* CRIAÇÃO */}
        {view === 'criar' && (
          <div className="max-w-md mx-auto bg-[#111] p-8 rounded-2xl border border-gray-800">
            <h2 className="text-2xl font-bold mb-6 text-[#00ff85] italic uppercase text-center">Configurar Torneio</h2>
            <form onSubmit={criarCampeonatoReal} className="space-y-4">
              <input required value={nome} onChange={e => setNome(e.target.value)} placeholder="NOME DO TORNEIO" className="w-full bg-[#0a0a0a] p-3 rounded border border-gray-700 outline-none" />
              <select value={formato} onChange={e => setFormato(e.target.value)} className="w-full bg-[#0a0a0a] p-3 rounded border border-gray-700 text-white outline-none">
                <option value="pontos-corridos">Pontos Corridos</option>
              </select>
              <input required type="number" value={qtdTimes} onChange={e => setQtdTimes(e.target.value)} placeholder="QTD TIMES" className="w-full bg-[#0a0a0a] p-3 rounded border border-gray-700 outline-none" />
              <button className="w-full py-3 bg-[#00ff85] text-black font-bold rounded-lg uppercase">CRIAR AGORA</button>
            </form>
          </div>
        )}

        {/* DETALHES DO CAMPEONATO */}
        {view === 'detalhes' && campeonatoAtivo && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            <div className="space-y-6">
              <button onClick={() => setView('home')} className="text-gray-500 text-xs font-bold uppercase">← Voltar</button>
              
              {/* ADMINS */}
              {isOwner && (
                <div className="bg-[#111] p-4 rounded-xl border border-gray-800">
                  <h4 className="font-bold mb-3 text-[10px] text-[#00ff85] uppercase italic tracking-widest">Convidar Admin</h4>
                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    await supabase.from('administradores').insert([{ campeonato_id: campeonatoAtivo.id, user_email: novoAdminEmail.toLowerCase().trim() }]);
                    setNovoAdminEmail('');
                    carregarDadosCampeonato(campeonatoAtivo);
                  }} className="flex gap-2">
                    <input required type="email" value={novoAdminEmail} onChange={e => setNovoAdminEmail(e.target.value)} className="flex-1 bg-[#0a0a0a] p-2 rounded text-xs border border-gray-700 outline-none" placeholder="Email" />
                    <button className="bg-[#00ff85] text-black px-2 rounded font-bold text-xs">+</button>
                  </form>
                </div>
              )}

              {/* ADICIONAR TIME */}
              {canEdit && times.length < campeonatoAtivo.qtd_times && (
                <div className="bg-[#111] p-5 rounded-xl border border-gray-800">
                  <h4 className="font-bold mb-4 text-xs uppercase text-gray-400 italic">Novo Participante</h4>
                  <form onSubmit={adicionarTimeCompleto} className="space-y-3">
                    <input required value={nomeTime} onChange={e => setNomeTime(e.target.value)} placeholder="Nome do Time" className="w-full bg-[#0a0a0a] p-2 rounded text-sm border border-gray-700 outline-none" />
                    <input value={nomeResponsavel} onChange={e => setNomeResponsavel(e.target.value)} placeholder="Jogador Responsável" className="w-full bg-[#0a0a0a] p-2 rounded text-sm border border-gray-700 outline-none" />
                    <div className="text-[10px] text-gray-500">
                        <label className="block mb-1">Escudo (Opcional)</label>
                        <input type="file" accept="image/*" onChange={e => setEscudoFile(e.target.files[0])} className="w-full" />
                    </div>
                    <button disabled={uploading} className="w-full py-2 bg-[#00ff85] text-black font-bold rounded text-xs uppercase">{uploading ? 'Salvando...' : 'Adicionar'}</button>
                  </form>
                </div>
              )}

              {/* LISTA DE TIMES NO CANTO */}
              <div className="bg-[#111] p-5 rounded-xl border border-gray-800">
                <h4 className="font-bold mb-4 text-xs uppercase text-gray-400 italic">Participantes ({times.length}/{campeonatoAtivo.qtd_times})</h4>
                <div className="space-y-2">
                  {times.map(t => (
                    <div key={t.id} className="flex items-center p-2 bg-[#0a0a0a] rounded border border-gray-800">
                      {t.escudo_url ? <img src={t.escudo_url} className="w-6 h-6 rounded-full mr-3 object-cover" alt="" /> : <div className="w-6 h-6 bg-gray-700 rounded-full mr-3 flex items-center justify-center text-[8px]">?</div>}
                      <div className="flex flex-col truncate">
                        <span className="text-sm font-bold truncate">{t.nome}</span>
                        <span className="text-[9px] text-gray-500 uppercase">{t.jogador_responsavel || 'S/ Jogador'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ÁREA CENTRAL (JOGOS / TABELA) */}
            <div className="lg:col-span-3">
              <div className="flex justify-between items-center mb-6">
                 <div className="flex space-x-2 bg-[#111] p-1 rounded-full border border-gray-800">
                    <button onClick={() => setActiveTab('confrontos')} className={`px-6 py-2 rounded-full font-bold text-xs uppercase transition ${activeTab === 'confrontos' ? 'bg-[#00ff85] text-black' : 'text-gray-400'}`}>Jogos</button>
                    <button onClick={() => setActiveTab('tabela')} className={`px-6 py-2 rounded-full font-bold text-xs uppercase transition ${activeTab === 'tabela' ? 'bg-[#00ff85] text-black' : 'text-gray-400'}`}>Tabela</button>
                 </div>
                 {canEdit && times.length > 1 && (
                    <button onClick={() => { if(window.confirm("Isso apagará os placares atuais. Continuar?")) gerarTabelaJogos() }} className="bg-white text-black px-6 py-2 rounded-full font-bold uppercase text-xs italic hover:bg-[#00ff85] transition">
                      {partidas.length > 0 ? 'Regerar Tabela' : 'Gerar Jogos'}
                    </button>
                 )}
              </div>

              {activeTab === 'confrontos' && (
                <div className="space-y-6">
                  {partidas.length === 0 ? <div className="text-gray-600 text-center py-20 border border-dashed border-gray-800 rounded-xl uppercase text-xs font-bold italic tracking-widest">Aguardando geração dos jogos...</div> : (
                    [...new Set(partidas.map(p => p.rodada))].sort((a,b) => a-b).map(r => (
                      <div key={r} className="bg-[#111] p-4 rounded-2xl border border-gray-800">
                        <h5 className="text-[#00ff85] font-black mb-4 uppercase text-xs italic tracking-widest border-b border-gray-800 pb-2">Rodada {r}</h5>
                        <div className="space-y-3">
                          {partidas.filter(p => p.rodada === r).map(p => (
                            <div key={p.id} className="flex items-center bg-[#0a0a0a] p-3 rounded-xl border border-gray-700">
                              <div className="flex-1 flex justify-end items-center space-x-3 pr-2 font-bold text-xs uppercase truncate">
                                <span>{p.time_casa?.nome}</span>
                                <img src={p.time_casa?.escudo_url || ''} className="w-8 h-8 rounded-full bg-black object-cover" alt="" />
                              </div>
                              <div className="flex items-center bg-black rounded-lg border border-gray-800">
                                <input type="number" value={p.gols_casa} disabled={!canEdit} onChange={(e) => mudarPlacarLocal(p.id, 'gols_casa', e.target.value)} className="w-10 h-10 bg-transparent text-center font-bold text-[#00ff85] outline-none border-none text-lg" />
                                <span className="text-gray-700 font-black px-1">X</span>
                                <input type="number" value={p.gols_fora} disabled={!canEdit} onChange={(e) => mudarPlacarLocal(p.id, 'gols_fora', e.target.value)} className="w-10 h-10 bg-transparent text-center font-bold text-[#00ff85] outline-none border-none text-lg" />
                              </div>
                              <div className="flex-1 flex justify-start items-center space-x-3 pl-2 font-bold text-xs uppercase truncate">
                                <img src={p.time_fora?.escudo_url || ''} className="w-8 h-8 rounded-full bg-black object-cover" alt="" />
                                <span>{p.time_fora?.nome}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === 'tabela' && (
                <div className="bg-[#111] rounded-xl border border-gray-800 overflow-hidden">
                  <table className="w-full text-left">
                    <thead className="bg-gray-900 text-[10px] text-gray-500 uppercase font-black italic">
                      <tr><th className="p-4">Pos</th><th className="p-4">Time</th><th className="p-4 text-center">PTS</th><th className="p-4 text-center">J</th><th className="p-4 text-center">SG</th></tr>
                    </thead>
                    <tbody className="text-sm">
                      {calcularClassificacao().map((t, i) => (
                        <tr key={t.id} className="border-b border-gray-800 hover:bg-black transition">
                          <td className="p-4 font-black text-gray-500 italic">{i+1}º</td>
                          <td className="p-4 flex items-center space-x-3 font-bold uppercase italic text-xs">
                            <img src={t.escudo_url || ''} className="w-6 h-6 rounded-full bg-gray-800 object-cover" alt="" />
                            <span>{t.nome}</span>
                          </td>
                          <td className="p-4 text-center font-black text-[#00ff85] text-lg">{t.p}</td>
                          <td className="p-4 text-center text-gray-500">{t.j}</td>
                          <td className="p-4 text-center font-bold text-gray-300">{t.sg}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;