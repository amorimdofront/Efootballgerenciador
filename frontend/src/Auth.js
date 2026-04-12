import React, { useState } from 'react';
import { supabase } from './supabaseClient';

export default function Auth({ onLogin }) {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);

  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    const { data, error } = isRegistering 
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      alert(error.message);
    } else {
      if (isRegistering) alert("Cadastro Realizado com sucesso !");
      onLogin(data.user);
    }
    setLoading(false);
  };

  return (
    <div className="max-w-md mx-auto bg-ef-card p-8 rounded-2xl border border-gray-800 mt-20">
      <h2 className="text-2xl font-bold mb-6 text-ef-green">
        {isRegistering ? 'Criar Conta' : 'Entrar no Sistema'}
      </h2>
      <form onSubmit={handleAuth} className="space-y-4">
        <input 
          type="email" placeholder="Seu e-mail" value={email}
          onChange={e => setEmail(e.target.value)}
          className="w-full bg-ef-dark p-3 rounded border border-gray-700" required
        />
        <input 
          type="password" placeholder="Sua senha" value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full bg-ef-dark p-3 rounded border border-gray-700" required
        />
        <button disabled={loading} className="w-full py-3 bg-ef-green text-black font-bold rounded-lg">
          {loading ? 'Processando...' : (isRegistering ? 'Cadastrar' : 'Entrar')}
        </button>
      </form>
      <button 
        onClick={() => setIsRegistering(!isRegistering)}
        className="mt-4 text-sm text-gray-400 hover:text-ef-green w-full"
      >
        {isRegistering ? 'Já tem conta? Entre aqui' : 'Não tem conta? Cadastre-se'}
      </button>
    </div>
  );
}