import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { type Categoria, configurado, hojeISO, type Membro, nomeMesTitulo, ok, somarMes, supabase } from "./dados";
import Ajustes from "./paginas/Ajustes";
import ContasFixas from "./paginas/ContasFixas";
import Lancamentos from "./paginas/Lancamentos";
import Receitas from "./paginas/Receitas";
import Resumo from "./paginas/Resumo";

const ABAS = [
  ["resumo", "Resumo"],
  ["lancamentos", "Gastos"],
  ["fixas", "Contas fixas"],
  ["receitas", "Receitas"],
  ["ajustes", "Orçamento e ajustes"],
] as const;
type Aba = (typeof ABAS)[number][0];

/** O que todas as páginas recebem. */
export interface Base {
  mes: string;
  categorias: Categoria[];
  membros: Membro[];
  /** A pessoa da casa que está logada (pelo e-mail). */
  eu: Membro | undefined;
  recarregarBase: () => Promise<void>;
}

export default function App() {
  const [sessao, setSessao] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSessao(data.session));
    const { data } = supabase.auth.onAuthStateChange((_evento, s) => setSessao(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!configurado) {
    return (
      <div className="login">
        <h1>💰 Gastos da Casa</h1>
        <p>Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env do painel.</p>
      </div>
    );
  }
  if (sessao === undefined) return null;
  if (!sessao) return <Login />;
  return <Painel email={sessao.user.email ?? ""} />;
}

/** Traduz os erros mais comuns do Supabase Auth, mantendo o texto original para diagnóstico. */
function explicarErroLogin(mensagem: string, status?: number): string {
  const m = mensagem.toLowerCase();
  let explicacao = "Não deu para enviar o link.";
  if (m.includes("rate limit") || status === 429) {
    explicacao = "Limite de e-mails do Supabase atingido. Espere cerca de 1 hora e tente de novo.";
  } else if (m.includes("seconds") || m.includes("security purposes")) {
    explicacao = "Aguarde 1 minuto antes de pedir outro link.";
  } else if (m.includes("signups not allowed") || m.includes("not found") || m.includes("user not")) {
    explicacao = "Este e-mail não está cadastrado em Authentication → Users no Supabase.";
  } else if (m.includes("redirect")) {
    explicacao = "O endereço do painel não está liberado em Authentication → URL Configuration.";
  }
  return `${explicacao} (Detalhe: ${mensagem})`;
}

function Login() {
  const [modo, setModo] = useState<"senha" | "link">("senha");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [estado, setEstado] = useState<"inicio" | "enviando" | "enviado">("inicio");
  const [erro, setErro] = useState("");

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setEstado("enviando");
    setErro("");
    if (modo === "senha") {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
      if (error) {
        setErro(
          error.message.toLowerCase().includes("invalid login")
            ? "E-mail ou senha incorretos."
            : explicarErroLogin(error.message, error.status),
        );
      }
      setEstado("inicio"); // com sucesso, o App troca para o painel sozinho
      return;
    }
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      // Só entra quem já foi convidado no Supabase; ninguém cria conta sozinho.
      options: { shouldCreateUser: false, emailRedirectTo: window.location.href.split("#")[0] },
    });
    if (error) {
      setErro(explicarErroLogin(error.message, error.status));
      setEstado("inicio");
    } else {
      setEstado("enviado");
    }
  }

  return (
    <div className="login">
      <h1>💰 Gastos da Casa</h1>
      {estado === "enviado" ? (
        <div className="cartao">
          <p>Enviamos um link de acesso para <strong>{email}</strong>. Abra o e-mail neste aparelho.</p>
        </div>
      ) : (
        <form className="cartao" onSubmit={entrar}>
          {erro && <div className="mensagem-erro">{erro}</div>}
          <label className="campo">
            E-mail
            <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </label>
          {modo === "senha" && (
            <label className="campo">
              Senha
              <input type="password" required autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
            </label>
          )}
          <button className="botao primario" disabled={estado === "enviando"}>
            {estado === "enviando" ? "Entrando…" : modo === "senha" ? "Entrar" : "Receber link de acesso"}
          </button>
          <button
            type="button"
            className="botao"
            style={{ border: 0, background: "none", color: "var(--texto-2)", fontSize: 13 }}
            onClick={() => {
              setModo(modo === "senha" ? "link" : "senha");
              setErro("");
            }}
          >
            {modo === "senha" ? "Prefiro receber um link por e-mail" : "Entrar com senha"}
          </button>
        </form>
      )}
    </div>
  );
}

function Painel({ email }: { email: string }) {
  const [aba, setAba] = useState<Aba>(() => {
    try {
      return (localStorage.getItem("aba") as Aba) || "resumo";
    } catch {
      return "resumo";
    }
  });
  const [mes, setMes] = useState(hojeISO().slice(0, 7));
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [membros, setMembros] = useState<Membro[]>([]);
  const [erro, setErro] = useState("");

  const recarregarBase = useCallback(async () => {
    try {
      const [cats, mems] = await Promise.all([
        supabase.from("categorias").select("*").order("nome"),
        supabase.from("membros").select("id, nome, telefone, email").order("nome"),
      ]);
      setCategorias(ok(cats) as Categoria[]);
      setMembros(ok(mems) as Membro[]);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);

  useEffect(() => {
    recarregarBase();
  }, [recarregarBase]);

  useEffect(() => {
    try {
      localStorage.setItem("aba", aba);
    } catch {
      /* navegação privada */
    }
  }, [aba]);

  const eu = membros.find((m) => m.email?.toLowerCase() === email.toLowerCase());
  const base: Base = { mes, categorias, membros, eu, recarregarBase };
  const semAcesso = !erro && membros.length === 0 && categorias.length === 0;

  return (
    <div className="app">
      <header className="topo">
        <h1>💰 Gastos da Casa</h1>
        <div className="seletor-mes">
          <button className="botao icone" onClick={() => setMes(somarMes(mes, -1))} aria-label="Mês anterior">‹</button>
          <strong>{nomeMesTitulo(mes)}</strong>
          <button className="botao icone" onClick={() => setMes(somarMes(mes, 1))} aria-label="Próximo mês">›</button>
        </div>
        <button className="botao" onClick={() => supabase.auth.signOut()} title={email}>Sair</button>
      </header>

      <nav className="abas" role="tablist">
        {ABAS.map(([id, nome]) => (
          <button key={id} role="tab" aria-selected={aba === id} onClick={() => setAba(id)}>
            {nome}
          </button>
        ))}
      </nav>

      {erro && <div className="mensagem-erro">{erro}</div>}
      {semAcesso && (
        <div className="mensagem-erro">
          O e-mail {email} não está cadastrado como pessoa da casa (tabela <code>membros</code>).
        </div>
      )}

      {aba === "resumo" && <Resumo {...base} />}
      {aba === "lancamentos" && <Lancamentos {...base} />}
      {aba === "fixas" && <ContasFixas {...base} />}
      {aba === "receitas" && <Receitas {...base} />}
      {aba === "ajustes" && <Ajustes {...base} />}
    </div>
  );
}
