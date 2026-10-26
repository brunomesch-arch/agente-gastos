import { useEffect, useState } from "react";
import type { Base } from "../App";
import { Erro } from "../componentes";
import { ok, reais, supabase } from "../dados";

export default function Ajustes({ categorias, membros, recarregarBase }: Base) {
  const [erro, setErro] = useState("");
  const [orcamentoTotal, setOrcamentoTotal] = useState("");
  const [novaCategoria, setNovaCategoria] = useState({ nome: "", emoji: "" });
  const [novoMembro, setNovoMembro] = useState({ nome: "", telefone: "", email: "" });

  useEffect(() => {
    supabase.from("configuracoes").select("valor").eq("chave", "orcamento_total_mensal").maybeSingle()
      .then(({ data }) => setOrcamentoTotal(data?.valor != null ? String(data.valor) : ""));
  }, []);

  async function executar(acao: () => PromiseLike<{ data: unknown; error: { message: string } | null }>) {
    try {
      ok(await acao());
      setErro("");
      await recarregarBase();
      return true;
    } catch (e) {
      setErro((e as Error).message);
      return false;
    }
  }

  const numeroOuNulo = (texto: string) => (texto.trim() === "" ? null : Number(texto.replace(",", ".")));
  const somaCategorias = categorias.reduce((s, c) => s + Number(c.orcamento_mensal ?? 0), 0);

  return (
    <div>
      <Erro erro={erro} />

      <section className="cartao">
        <h2>Orçamento da casa <small>limite de gasto total por mês</small></h2>
        <form className="formulario" onSubmit={(e) => {
          e.preventDefault();
          executar(() => supabase.from("configuracoes").upsert({ chave: "orcamento_total_mensal", valor: numeroOuNulo(orcamentoTotal) }));
        }}>
          <label className="campo">
            Valor (R$)
            <input type="number" step="0.01" min="0" value={orcamentoTotal} onChange={(e) => setOrcamentoTotal(e.target.value)} placeholder="sem orçamento" />
          </label>
          <button className="botao primario">Salvar</button>
          <span className="detalhe">Soma dos orçamentos por categoria: {reais(somaCategorias)}</span>
        </form>
      </section>

      <section className="cartao secao">
        <h2>Categorias e orçamento por categoria <small>deixe em branco para não ter limite</small></h2>
        <div className="tabela-rolagem">
          <table>
            <thead>
              <tr><th>Categoria</th><th className="num">Orçamento mensal</th><th>Ativa</th></tr>
            </thead>
            <tbody>
              {categorias.map((c) => (
                <tr key={c.id}>
                  <td>{c.emoji} {c.nome}</td>
                  <td className="num">
                    <input
                      type="number" step="0.01" min="0" style={{ width: 130, textAlign: "right" }}
                      defaultValue={c.orcamento_mensal ?? ""}
                      aria-label={`Orçamento de ${c.nome}`}
                      onBlur={(e) => {
                        const valor = numeroOuNulo(e.target.value);
                        if (valor !== (c.orcamento_mensal === null ? null : Number(c.orcamento_mensal))) {
                          executar(() => supabase.from("categorias").update({ orcamento_mensal: valor }).eq("id", c.id));
                        }
                      }}
                    />
                  </td>
                  <td>
                    <input type="checkbox" checked={c.ativa} aria-label={`${c.nome} ativa`}
                      onChange={(e) => executar(() => supabase.from("categorias").update({ ativa: e.target.checked }).eq("id", c.id))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="formulario secao" onSubmit={async (e) => {
          e.preventDefault();
          if (await executar(() => supabase.from("categorias").insert({ nome: novaCategoria.nome.trim(), emoji: novaCategoria.emoji || null }))) {
            setNovaCategoria({ nome: "", emoji: "" });
          }
        }}>
          <label className="campo">
            Emoji
            <input style={{ width: 64 }} value={novaCategoria.emoji} onChange={(e) => setNovaCategoria({ ...novaCategoria, emoji: e.target.value })} />
          </label>
          <label className="campo" style={{ flex: 1, minWidth: 160 }}>
            Nova categoria
            <input required value={novaCategoria.nome} onChange={(e) => setNovaCategoria({ ...novaCategoria, nome: e.target.value })} />
          </label>
          <button className="botao">Criar categoria</button>
        </form>
      </section>

      <section className="cartao secao">
        <h2>Pessoas da casa <small>quem pode mandar gastos no WhatsApp e entrar no painel</small></h2>
        <table>
          <thead>
            <tr><th>Nome</th><th>WhatsApp</th><th className="esconder-celular">E-mail do painel</th></tr>
          </thead>
          <tbody>
            {membros.map((m) => (
              <tr key={m.id}><td>{m.nome}</td><td>{m.telefone}</td><td className="esconder-celular">{m.email ?? "—"}</td></tr>
            ))}
          </tbody>
        </table>
        <form className="formulario secao" onSubmit={async (e) => {
          e.preventDefault();
          const telefone = "+" + novoMembro.telefone.replace(/\D/g, "");
          if (await executar(() => supabase.from("membros").insert({ nome: novoMembro.nome.trim(), telefone, email: novoMembro.email.trim() || null }))) {
            setNovoMembro({ nome: "", telefone: "", email: "" });
          }
        }}>
          <label className="campo">
            Nome
            <input required value={novoMembro.nome} onChange={(e) => setNovoMembro({ ...novoMembro, nome: e.target.value })} />
          </label>
          <label className="campo">
            WhatsApp (com DDI e DDD)
            <input required placeholder="+55 47 99999-8888" value={novoMembro.telefone} onChange={(e) => setNovoMembro({ ...novoMembro, telefone: e.target.value })} />
          </label>
          <label className="campo">
            E-mail
            <input type="email" value={novoMembro.email} onChange={(e) => setNovoMembro({ ...novoMembro, email: e.target.value })} />
          </label>
          <button className="botao">Adicionar pessoa</button>
        </form>
      </section>
    </div>
  );
}
