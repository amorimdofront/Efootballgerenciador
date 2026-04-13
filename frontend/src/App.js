import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import Auth from './Auth';

function App() {
  const [view, setView] = useState('home'); 
  const [activeTab, setActiveTab] = useState('confrontos'); 
  const [user, setUser] = useState(null);

  const [campeonatos, setCampeonatos] = useState([]);
  const [campeonatoAtivo, setCampeonatoAtivo] = useState(null);
  const [times, setTimes] = useState([]);
  const [partidas, setPartidas] = useState([]);
  const [admins, setAdmins] = useState([]);
  
  const [nome, setNome] = useState('');
  const [formato, setFormato] = useState('pontos-corridos-mata-mata');
  const [qtdTimes, setQtdTimes] = useState(16);
  const [qtdClassificadosCriacao, setQtdClassificadosCriacao] = useState(4); 
  const [nomeTime, setNomeTime] = useState('');
  const [nomeResponsavel, setNomeResponsavel] = useState('');
  const [escudoFile, setEscudoFile] = useState(null); 
  const [uploading, setUploading] = useState(false);
  const [novoAdminEmail, setNovoAdminEmail] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  const carregarCampeonatos = async () => {
    const { data } = await supabase.from('campeonatos').select('*').order('created_at', { ascending: false });
    if (data) setCampeonatos(data);
  };

  useEffect(() => { carregarCampeonatos(); }, [user]);

  const carregarDadosCampeonato = async (champ) => {
    setCampeonatoAtivo(champ);
    const { data: t } = await supabase.from('times').select('*').eq('campeonato_id', champ.id).order('created_at', { ascending: true });
    if (t) setTimes(t);
    const { data: p } = await supabase.from('partidas')
      .select(`*, time_casa:time_casa_id(nome, escudo_url), time_fora:time_fora_id(nome, escudo_url)`)
      .eq('campeonato_id', champ.id)
      .order('id', { ascending: true });
    if (p) setPartidas(p);
    const { data: a } = await supabase.from('administradores').select('*').eq('campeonato_id', champ.id);
    if (a) setAdmins(a);
    setView('detalhes');
  };

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
      partidas.filter(m => m.status === 'finalizado' && m.rodada < 80).forEach(m => { 
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

  const criarCampeonatoReal = async (e) => {
    e.preventDefault();
    const { error } = await supabase.from('campeonatos').insert([{ 
      nome, 
      formato, 
      qtd_times: parseInt(qtdTimes), 
      qtd_classificados: parseInt(qtdClassificadosCriacao),
      criador_id: user.id 
    }]);
    if (!error) { setNome(''); carregarCampeonatos(); setView('home'); }
  };

  const atualizarConfigCampeonato = async (campo, valor) => {
    if (!campeonatoAtivo || user.id !== campeonatoAtivo.criador_id) return;
    const { error } = await supabase.from('campeonatos').update({ [campo]: valor }).eq('id', campeonatoAtivo.id);
    if (!error) {
      setCampeonatoAtivo({ ...campeonatoAtivo, [campo]: valor });
    }
  };

  const adicionarTimeCompleto = async (e) => {
    e.preventDefault();
    setUploading(true);
    let escudoUrl = null;
    if (escudoFile) {
      const fileName = `${user.id}-${Date.now()}`;
      const { error: upErr } = await supabase.storage.from('escudos').upload(fileName, escudoFile);
      if (!upErr) {
        const { data: pUrl } = supabase.storage.from('escudos').getPublicUrl(fileName);
        escudoUrl = pUrl.publicUrl;
      }
    }
    await supabase.from('times').insert([{ campeonato_id: campeonatoAtivo.id, nome: nomeTime, jogador_responsavel: nomeResponsavel, escudo_url: escudoUrl }]);
    setNomeTime(''); setNomeResponsavel(''); setEscudoFile(null);
    setUploading(false);
    carregarDadosCampeonato(campeonatoAtivo);
  };

  // NOVA FUNÇÃO: Remover Time
  const removerTime = async (timeId) => {
    if (!window.confirm("ATENÇÃO: Tem certeza que deseja remover este time?\n\nSe já houver jogos gerados, recomendamos clicar em 'REGERAR JOGOS' logo após excluir o time para não quebrar a tabela.")) return;
    
    // Primeiro tentamos remover as partidas onde este time aparece (para evitar erro de chave estrangeira)
    await supabase.from('partidas').delete().or(`time_casa_id.eq.${timeId},time_fora_id.eq.${timeId}`);
    
    // Agora exclui o time
    const { error } = await supabase.from('times').delete().eq('id', timeId);
    
    if (!error) {
      carregarDadosCampeonato(campeonatoAtivo);
    } else {
      alert("Erro ao remover o time. Verifique o banco de dados.");
    }
  };

  const gerarTabelaJogos = async () => {
    await supabase.from('partidas').delete().eq('campeonato_id', campeonatoAtivo.id);
    let ts = [...times];
    if (ts.length % 2 !== 0) ts.push({ id: null, nome: 'FOLGA' });
    const rounds = ts.length - 1;
    const half = ts.length / 2;
    const matches = [];
    for (let r = 1; r <= rounds; r++) {
      for (let i = 0; i < half; i++) {
        const casa = ts[i]; const fora = ts[ts.length - 1 - i];
        if (casa.id && fora.id) matches.push({ campeonato_id: campeonatoAtivo.id, time_casa_id: casa.id, time_fora_id: fora.id, rodada: r, status: 'agendado' });
      }
      ts.splice(1, 0, ts.pop());
    }
    await supabase.from('partidas').insert(matches);
    carregarDadosCampeonato(campeonatoAtivo);
  };

  const gerarMataMata = async () => {
    const qtd = campeonatoAtivo.qtd_classificados || 4;
    const classif = calcularClassificacao().slice(0, qtd);
    if (classif.length < qtd) return alert(`Precisa de ${qtd} times para o mata-mata.`);
    
    let matches = [];
    if (qtd === 8) {
      matches = [
        { campeonato_id: campeonatoAtivo.id, time_casa_id: classif[0].id, time_fora_id: classif[7].id, rodada: 80, status: 'agendado' },
        { campeonato_id: campeonatoAtivo.id, time_casa_id: classif[3].id, time_fora_id: classif[4].id, rodada: 81, status: 'agendado' },
        { campeonato_id: campeonatoAtivo.id, time_casa_id: classif[1].id, time_fora_id: classif[6].id, rodada: 82, status: 'agendado' },
        { campeonato_id: campeonatoAtivo.id, time_casa_id: classif[2].id, time_fora_id: classif[5].id, rodada: 83, status: 'agendado' }
      ];
    } else {
      matches = [
        { campeonato_id: campeonatoAtivo.id, time_casa_id: classif[0].id, time_fora_id: classif[3].id, rodada: 90, status: 'agendado' },
        { campeonato_id: campeonatoAtivo.id, time_casa_id: classif[1].id, time_fora_id: classif[2].id, rodada: 91, status: 'agendado' }
      ];
    }
    await supabase.from('partidas').insert(matches);
    carregarDadosCampeonato(campeonatoAtivo);
  };

  const avancarParaSemis = async () => {
    const quartas = partidas.filter(p => p.rodada >= 80 && p.rodada <= 83).sort((a,b) => a.rodada - b.rodada);
    const getVencedor = (p) => p.gols_fora > p.gols_casa ? p.time_fora_id : p.time_casa_id; 

    const semis = [
      { campeonato_id: campeonatoAtivo.id, time_casa_id: getVencedor(quartas[0]), time_fora_id: getVencedor(quartas[1]), rodada: 90, status: 'agendado' },
      { campeonato_id: campeonatoAtivo.id, time_casa_id: getVencedor(quartas[2]), time_fora_id: getVencedor(quartas[3]), rodada: 91, status: 'agendado' }
    ];
    await supabase.from('partidas').insert(semis);
    carregarDadosCampeonato(campeonatoAtivo);
  };

  const canEdit = (user && campeonatoAtivo && user.id === campeonatoAtivo.criador_id) || (user && admins.some(a => a.user_email === user.email.toLowerCase()));
  const isOwner = user && campeonatoAtivo && user.id === campeonatoAtivo.criador_id;
  const limiteClassificados = campeonatoAtivo?.qtd_classificados || 4;

  const quartasFinalizadas = partidas.filter(p => p.rodada >= 80 && p.rodada <= 83).length === 4 && partidas.filter(p => p.rodada >= 80 && p.rodada <= 83).every(p => p.status === 'finalizado');
  const semisExistem = partidas.some(p => p.rodada >= 90 && p.rodada <= 91);
  const mataMataIniciado = partidas.some(p => p.rodada >= 80);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans">
      <nav className="border-b border-gray-800 p-4 flex justify-between items-center bg-[#111] sticky top-0 z-50">
        <h1 className="text-2xl font-bold italic text-[#00ff85] cursor-pointer" onClick={() => setView('home')}>eFOOTBALL CHAMP</h1>
        {user ? <button onClick={() => supabase.auth.signOut()} className="text-red-500 text-xs font-bold uppercase">Sair</button> : <button onClick={() => setView('login')} className="bg-[#00ff85] text-black px-4 py-2 rounded-full font-bold text-xs">Entrar</button>}
      </nav>

      <main className="p-6 max-w-7xl mx-auto">
        {view === 'login' && <Auth onLogin={() => { setView('home'); carregarCampeonatos(); }} />}

        {view === 'home' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {campeonatos.map(c => (
              <div key={c.id} className="bg-[#111] p-6 rounded-2xl border border-gray-800 flex flex-col justify-between h-44 hover:border-[#00ff85] transition">
                <h3 className="text-xl font-bold italic uppercase text-[#00ff85]">{c.nome}</h3>
                <button onClick={() => carregarDadosCampeonato(c)} className="w-full py-2 bg-gray-800 text-white font-bold rounded-lg hover:bg-[#00ff85] hover:text-black transition uppercase text-sm">Gerenciar</button>
              </div>
            ))}
            <div onClick={() => user ? setView('criar') : setView('login')} className="border-2 border-dashed border-gray-800 p-6 rounded-2xl flex items-center justify-center text-gray-500 cursor-pointer h-44 font-black italic hover:border-[#00ff85]">+ Novo Torneio</div>
          </div>
        )}

        {view === 'criar' && (
          <div className="max-w-md mx-auto bg-[#111] p-8 rounded-2xl border border-gray-800">
            <h2 className="text-2xl font-bold mb-6 text-[#00ff85] italic uppercase text-center">Configurar Torneio</h2>
            <form onSubmit={criarCampeonatoReal} className="space-y-4">
              <input required value={nome} onChange={e => setNome(e.target.value)} placeholder="NOME DO TORNEIO" className="w-full bg-[#0a0a0a] p-3 rounded border border-gray-700 outline-none" />
              <select value={formato} onChange={e => setFormato(e.target.value)} className="w-full bg-[#0a0a0a] p-3 rounded border border-gray-700 outline-none text-gray-300">
                <option value="pontos-corridos-mata-mata">Pontos Corridos + Mata-Mata</option>
                <option value="pontos-corridos">Apenas Pontos Corridos</option>
              </select>
              <div className="flex gap-4">
                 <input required type="number" value={qtdTimes} onChange={e => setQtdTimes(e.target.value)} placeholder="QTD TIMES" className="w-1/2 bg-[#0a0a0a] p-3 rounded border border-gray-700 outline-none" />
                 <select value={qtdClassificadosCriacao} onChange={e => setQtdClassificadosCriacao(e.target.value)} className="w-1/2 bg-[#0a0a0a] p-3 rounded border border-gray-700 outline-none text-gray-300">
                   <option value={4}>Classificam 4</option>
                   <option value={8}>Classificam 8</option>
                 </select>
              </div>
              <button className="w-full py-3 bg-[#00ff85] text-black font-bold rounded-lg uppercase">CRIAR AGORA</button>
            </form>
          </div>
        )}

        {view === 'detalhes' && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            <div className="space-y-6">
              <button onClick={() => setView('home')} className="text-gray-500 text-xs font-bold uppercase">← Voltar</button>
              
              {isOwner && (
                <div className="bg-[#111] p-4 rounded-xl border border-gray-800 space-y-4">
                  <h4 className="font-bold text-[10px] text-[#00ff85] uppercase italic tracking-widest border-b border-gray-800 pb-2">Configuração do Torneio</h4>
                  
                  <div>
                    <label className="text-[10px] text-gray-500 uppercase mb-1 block">Formato</label>
                    <select value={campeonatoAtivo.formato || 'pontos-corridos'} onChange={e => atualizarConfigCampeonato('formato', e.target.value)} className="w-full bg-[#0a0a0a] p-2 rounded text-xs border border-gray-700 outline-none text-gray-300">
                      <option value="pontos-corridos-mata-mata">Pontos Corridos + Mata-Mata</option>
                      <option value="pontos-corridos">Apenas Pontos Corridos</option>
                    </select>
                  </div>

                  {campeonatoAtivo.formato === 'pontos-corridos-mata-mata' && (
                    <div>
                      <label className="text-[10px] text-gray-500 uppercase mb-1 block">Classificados p/ Fase Final</label>
                      <select value={campeonatoAtivo.qtd_classificados || 4} onChange={e => atualizarConfigCampeonato('qtd_classificados', parseInt(e.target.value))} className="w-full bg-[#0a0a0a] p-2 rounded text-xs border border-gray-700 outline-none text-gray-300">
                        <option value={4}>Top 4 (Semifinais)</option>
                        <option value={8}>Top 8 (Quartas de Final)</option>
                      </select>
                    </div>
                  )}
                </div>
              )}

              {isOwner && (
                <div className="bg-[#111] p-4 rounded-xl border border-gray-800">
                  <h4 className="font-bold mb-3 text-[10px] text-[#00ff85] uppercase italic tracking-widest">Convidar Admin</h4>
                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    await supabase.from('administradores').insert([{ campeonato_id: campeonatoAtivo.id, user_email: novoAdminEmail.toLowerCase().trim() }]);
                    setNovoAdminEmail(''); carregarDadosCampeonato(campeonatoAtivo);
                  }} className="flex gap-2">
                    <input required type="email" value={novoAdminEmail} onChange={e => setNovoAdminEmail(e.target.value)} className="flex-1 bg-[#0a0a0a] p-2 rounded text-xs border border-gray-700 outline-none" placeholder="Email" />
                    <button className="bg-[#00ff85] text-black px-2 rounded font-bold text-xs">+</button>
                  </form>
                </div>
              )}

              {canEdit && times.length < campeonatoAtivo.qtd_times && (
                <div className="bg-[#111] p-5 rounded-xl border border-gray-800">
                  <h4 className="font-bold mb-4 text-xs uppercase text-gray-400 italic">Novo Time</h4>
                  <form onSubmit={adicionarTimeCompleto} className="space-y-3">
                    <input required value={nomeTime} onChange={e => setNomeTime(e.target.value)} placeholder="Nome" className="w-full bg-[#0a0a0a] p-2 rounded text-sm border border-gray-700 outline-none" />
                    <input value={nomeResponsavel} onChange={e => setNomeResponsavel(e.target.value)} placeholder="Responsável" className="w-full bg-[#0a0a0a] p-2 rounded text-sm border border-gray-700 outline-none" />
                    <input type="file" onChange={e => setEscudoFile(e.target.files[0])} className="text-[10px]" />
                    <button className="w-full py-2 bg-[#00ff85] text-black font-bold rounded text-xs uppercase">Salvar</button>
                  </form>
                </div>
              )}

              {/* LISTA LATERAL DE TIMES (Com opção de Remover) */}
              <div className="bg-[#111] p-5 rounded-xl border border-gray-800">
                <h4 className="font-bold mb-4 text-xs uppercase text-gray-400 italic">Times ({times.length})</h4>
                {times.map(t => (
                  <div key={t.id} className="flex items-center justify-between p-2 mb-2 bg-[#0a0a0a] rounded border border-gray-800 group">
                    <div className="flex items-center overflow-hidden">
                      {t.escudo_url ? <img src={t.escudo_url} className="w-8 h-8 rounded-full mr-3 object-cover border border-gray-700" alt="escudo" /> : <div className="w-8 h-8 bg-gray-800 rounded-full mr-3 border border-gray-700 flex-shrink-0" />}
                      <div className="flex flex-col truncate">
                        <span className="text-sm font-bold truncate text-white">{t.nome}</span>
                        <span className="text-[9px] text-gray-500 uppercase">{t.jogador_responsavel || 'S/ Responsável'}</span>
                      </div>
                    </div>
                    
                    {/* BOTÃO REMOVER TIME (X) */}
                    {canEdit && (
                      <button 
                        onClick={() => removerTime(t.id)} 
                        className="text-red-500 hover:bg-red-500 hover:text-white w-6 h-6 rounded flex items-center justify-center font-bold text-xs opacity-0 group-hover:opacity-100 transition-all"
                        title="Remover Time"
                      >
                        X
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-3">
              <div className="flex justify-between items-center mb-6">
                <div className="flex bg-[#111] p-1 rounded-full border border-gray-800">
                  <button onClick={() => setActiveTab('confrontos')} className={`px-6 py-2 rounded-full font-bold text-xs uppercase ${activeTab === 'confrontos' ? 'bg-[#00ff85] text-black' : 'text-gray-400'}`}>Jogos</button>
                  <button onClick={() => setActiveTab('tabela')} className={`px-6 py-2 rounded-full font-bold text-xs uppercase ${activeTab === 'tabela' ? 'bg-[#00ff85] text-black' : 'text-gray-400'}`}>Tabela</button>
                </div>
                {canEdit && (
                  <div className="flex gap-2">
                    {/* Botão original de Gerar Jogos */}
                    {partidas.length === 0 && times.length > 1 && (
                      <button onClick={gerarTabelaJogos} className="bg-white text-black px-4 py-2 rounded-full font-bold text-xs">GERAR JOGOS</button>
                    )}
                    
                    {/* NOVO BOTÃO: REGERAR JOGOS (Visível se já existirem partidas) */}
                    {partidas.length > 0 && (
                      <button onClick={() => {
                        if(window.confirm("🚨 PERIGO: Isso vai apagar TODOS os placares atuais e fará um novo sorteio do zero. Deseja continuar?")) {
                          gerarTabelaJogos();
                        }
                      }} className="bg-red-600/20 text-red-500 border border-red-600 hover:bg-red-600 hover:text-white px-4 py-2 rounded-full font-bold text-xs transition">
                        REGERAR JOGOS
                      </button>
                    )}

                    {campeonatoAtivo?.formato === 'pontos-corridos-mata-mata' && partidas.length > 0 && !mataMataIniciado && (
                      <button onClick={gerarMataMata} className="bg-[#00ff85] text-black px-4 py-2 rounded-full font-bold text-xs">GERAR MATA-MATA</button>
                    )}

                    {quartasFinalizadas && !semisExistem && (
                       <button onClick={avancarParaSemis} className="bg-white text-black px-4 py-2 rounded-full font-bold text-xs shadow-[0_0_10px_#00ff85]">AVANÇAR PARA SEMIS</button>
                    )}
                  </div>
                )}
              </div>

              {activeTab === 'confrontos' && (
                <div className="space-y-6">
                  
                  {/* QUARTAS DE FINAL */}
                  {partidas.some(p => p.rodada >= 80 && p.rodada <= 83) && (
                    <div className="border-2 border-[#00ff85] p-6 rounded-2xl bg-[#050505] mb-6">
                      <h2 className="text-[#00ff85] font-black italic mb-6 uppercase text-center text-lg">Quartas de Final</h2>
                      {partidas.filter(p => p.rodada >= 80 && p.rodada <= 83).map(p => (
                        <div key={p.id} className="flex items-center bg-[#111] p-4 rounded-xl border border-gray-800 mb-4">
                           <div className="flex-1 flex justify-end items-center gap-3 pr-4">
                             <span className="font-bold uppercase italic text-xs truncate text-right">{p.time_casa?.nome}</span>
                             {p.time_casa?.escudo_url ? <img src={p.time_casa.escudo_url} className="w-8 h-8 rounded-full object-cover border border-gray-700" alt="casa" /> : <div className="w-8 h-8 rounded-full bg-gray-800 border border-gray-700" />}
                           </div>
                           <div className="flex gap-2">
                             <input type="number" value={p.gols_casa} onChange={e => mudarPlacarLocal(p.id, 'gols_casa', e.target.value)} className="w-12 h-12 bg-black text-center text-[#00ff85] font-bold rounded border border-gray-700" />
                             <input type="number" value={p.gols_fora} onChange={e => mudarPlacarLocal(p.id, 'gols_fora', e.target.value)} className="w-12 h-12 bg-black text-center text-[#00ff85] font-bold rounded border border-gray-700" />
                           </div>
                           <div className="flex-1 flex justify-start items-center gap-3 pl-4">
                             {p.time_fora?.escudo_url ? <img src={p.time_fora.escudo_url} className="w-8 h-8 rounded-full object-cover border border-gray-700" alt="fora" /> : <div className="w-8 h-8 rounded-full bg-gray-800 border border-gray-700" />}
                             <span className="font-bold uppercase italic text-xs truncate text-left">{p.time_fora?.nome}</span>
                           </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* SEMI FINAIS */}
                  {partidas.some(p => p.rodada >= 90 && p.rodada <= 91) && (
                    <div className="border-2 border-[#00ff85] p-6 rounded-2xl bg-[#050505] mb-10 shadow-[0_0_15px_rgba(0,255,133,0.1)]">
                      <h2 className="text-[#00ff85] font-black italic mb-6 uppercase text-center text-lg">Semi-finais</h2>
                      {partidas.filter(p => p.rodada >= 90 && p.rodada <= 91).map(p => (
                        <div key={p.id} className="flex items-center bg-[#111] p-4 rounded-xl border border-gray-800 mb-4">
                           <div className="flex-1 flex justify-end items-center gap-3 pr-4">
                             <span className="font-bold uppercase italic text-xs truncate text-right">{p.time_casa?.nome}</span>
                             {p.time_casa?.escudo_url ? <img src={p.time_casa.escudo_url} className="w-8 h-8 rounded-full object-cover border border-gray-700" alt="casa" /> : <div className="w-8 h-8 rounded-full bg-gray-800 border border-gray-700" />}
                           </div>
                           <div className="flex gap-2">
                             <input type="number" value={p.gols_casa} onChange={e => mudarPlacarLocal(p.id, 'gols_casa', e.target.value)} className="w-12 h-12 bg-black text-center text-[#00ff85] font-bold rounded border border-gray-700" />
                             <input type="number" value={p.gols_fora} onChange={e => mudarPlacarLocal(p.id, 'gols_fora', e.target.value)} className="w-12 h-12 bg-black text-center text-[#00ff85] font-bold rounded border border-gray-700" />
                           </div>
                           <div className="flex-1 flex justify-start items-center gap-3 pl-4">
                             {p.time_fora?.escudo_url ? <img src={p.time_fora.escudo_url} className="w-8 h-8 rounded-full object-cover border border-gray-700" alt="fora" /> : <div className="w-8 h-8 rounded-full bg-gray-800 border border-gray-700" />}
                             <span className="font-bold uppercase italic text-xs truncate text-left">{p.time_fora?.nome}</span>
                           </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* FASE REGULAR */}
                  {[...new Set(partidas.filter(p => p.rodada < 80).map(p => p.rodada))].sort((a,b) => a-b).map(r => (
                    <div key={r} className="bg-[#111] p-4 rounded-xl border border-gray-800">
                      <h5 className="text-[#00ff85] font-bold mb-4 uppercase text-[10px] italic">Rodada {r}</h5>
                      {partidas.filter(p => p.rodada === r).map(p => (
                        <div key={p.id} className="flex items-center justify-between p-2 hover:bg-black rounded-lg transition">
                          <div className="flex-1 flex justify-end items-center gap-2 pr-3">
                            <span className="text-[11px] font-bold uppercase truncate text-right">{p.time_casa?.nome}</span>
                            {p.time_casa?.escudo_url ? <img src={p.time_casa.escudo_url} className="w-5 h-5 rounded-full object-cover" alt="casa" /> : <div className="w-5 h-5 rounded-full bg-gray-800" />}
                          </div>
                          
                          <div className="flex items-center gap-1">
                            <input value={p.gols_casa} onChange={e => mudarPlacarLocal(p.id, 'gols_casa', e.target.value)} className="w-8 h-8 bg-transparent text-center font-black text-[#00ff85] outline-none" />
                            <span className="text-gray-700 text-[10px]">x</span>
                            <input value={p.gols_fora} onChange={e => mudarPlacarLocal(p.id, 'gols_fora', e.target.value)} className="w-8 h-8 bg-transparent text-center font-black text-[#00ff85] outline-none" />
                          </div>
                          
                          <div className="flex-1 flex justify-start items-center gap-2 pl-3">
                            {p.time_fora?.escudo_url ? <img src={p.time_fora.escudo_url} className="w-5 h-5 rounded-full object-cover" alt="fora" /> : <div className="w-5 h-5 rounded-full bg-gray-800" />}
                            <span className="text-[11px] font-bold uppercase truncate text-left">{p.time_fora?.nome}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {/* TABELA DE CLASSIFICAÇÃO */}
              {activeTab === 'tabela' && (
                <div className="bg-[#111] rounded-xl border border-gray-800 overflow-hidden">
                  <table className="w-full text-left">
                    <thead className="bg-gray-900 text-[10px] text-gray-500 uppercase font-black italic">
                      <tr><th className="p-4">Pos</th><th className="p-4">Time</th><th className="p-4 text-center">PTS</th><th className="p-4 text-center">J</th><th className="p-4 text-center">SG</th></tr>
                    </thead>
                    <tbody className="text-sm">
                      {calcularClassificacao().map((t, i) => (
                        <tr key={t.id} className={`border-b border-gray-800 hover:bg-black transition ${i < limiteClassificados && campeonatoAtivo?.formato === 'pontos-corridos-mata-mata' ? 'bg-[#00ff8505]' : ''}`}>
                          <td className={`p-4 font-black italic ${i < limiteClassificados && campeonatoAtivo?.formato === 'pontos-corridos-mata-mata' ? 'text-[#00ff85]' : 'text-gray-500'}`}>{i+1}º</td>
                          <td className="p-4 flex items-center gap-3">
                            {t.escudo_url ? <img src={t.escudo_url} className="w-8 h-8 rounded-full object-cover border border-gray-700" alt="escudo" /> : <div className="w-8 h-8 bg-gray-800 rounded-full border border-gray-700 flex-shrink-0" />}
                            <div className="flex flex-col truncate">
                              <span className="font-bold uppercase text-xs text-white">{t.nome}</span>
                              <span className="text-[9px] text-gray-500 uppercase">{t.jogador_responsavel || 'S/ Responsável'}</span>
                            </div>
                          </td>
                          <td className="p-4 text-center font-black text-[#00ff85] text-lg">{t.p}</td>
                          <td className="p-4 text-center text-gray-500">{t.j}</td>
                          <td className="p-4 text-center text-gray-400">{t.sg}</td>
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