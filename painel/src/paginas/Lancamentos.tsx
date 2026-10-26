import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { Base } from "../App";
import { Erro } from "../componentes";
import {
  dataCurta,
  FORMAS_PAGAMENTO,
  hojeISO,
  type Lancamento,
  limitesMes,
  ok,
  reais,
  supabase,
} from "../dados";

const ORIGEM_ICONE: Record<string, string> = { foto: "📷", audio: "🎙️", texto: "💬", documento: "📄", painel: "🖥️" };

export default function Lancamentos({ mes, categorias, membros }: Base) {
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroMembro, setFiltroMembro] = useState("");
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [inicio, fim] = limitesMes(mes);
      const resp = await supabase
        .from("lancamentos")
        .select("*")
        .gte("data", inicio)
        .lt("data", fim)
        .order("data", { ascending: false })
        .order("id", { ascending: false });
      setLancamentos(ok(resp) as Lancamento[]);
      setErro("");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [mes]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const membro = (id: string | null) => membros.find((m) => m.id === id)?.nome ?? "—";

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return lancamentos.filter(
      (l) =>
        (!filtroCategoria || l.categoria_id === Number(filtroCategoria)) &&
        (!filtroMembro || l.membro_id === filtroMembro) &&
        (!termo || `${l.descricao} ${l.estabelecimento ?? ""}`.toLowerCase().includes(termo)),
    );
  }, [lancamentos, filtroCategoria, filtroMembro, busca]);
  const total = filtrados.reduce((s, l) => s + Number(l.valor), 0);

  async function alterar(id: number, campos: Partial<Lancamento>) {
    try {
      ok(await supabase.from("lancamentos").update(campos).eq("id", id));
      setLancamentos((ls) => ls.map((l) => (l.id === id ? { ...l, ...campos } : l)));
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function excluir(l: Lancamento) {
    if (!confirm(`Apagar "${l.descricao}" de ${reais(Number(l.valor))}?`)) return;
    try {
      ok(await supabase.from("lancamentos").delete().eq("id", l.id));
      setLancamentos((ls) => ls.filter((x) => x.id !== l.id));
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function verComprovante(caminho: string) {
    const { data, error } = await supabase.storage.from("comprovantes").createSignedUrl(caminho, 300);
    if (error) setErro(error.message);
    else window.open(data.signedUrl, "_blank", "noopener");
  }

  return (
    <div className={carregando ? "carregando" : ""}>
      <Erro erro={erro} />
      <NovoGasto base={{ categorias, membros }} aoSalvar={carregar} />

      <section className="cartao">
        <div className="filtros">
          <label className="campo">
            Categoria
            <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)}>
              <option value="">Todas</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>{c.emoji} {c.nome}</option>
              ))}
            </select>
          </label>
          <label className="campo">
            Pessoa
            <select value={filtroMembro} onChange={(e) => setFiltroMembro(e.target.value)}>
              <option value="">Todas</option>
              {membros.map((m) => (
                <option key={m.id} value={m.id}>{m.nome}</option>
              ))}
            </select>
          </label>
          <label className="campo" style={{ flex: 1, minWidth: 160 }}>
            Buscar
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="loja ou descrição" />
          </label>
          <div className="campo">
            <span>{filtrados.length} gastos</span>
            <strong style={{ fontSize: 16, color: "var(--texto)" }}>{reais(total)}</strong>
          </div>
        </div>

        <div className="tabela-rolagem">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Descrição</th>
                <th>Categoria</th>
                <th className="esconder-celular">Quem</th>
                <th className="num">Valor</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtrados.length === 0 && (
                <tr><td colSpan={6} className="vazio">Nenhum gasto encontrado.</td></tr>
              )}
              {filtrados.map((l) => (
                <Fragment key={l.id}>
                  <tr>
                    <td>{dataCurta(l.data)}</td>
                    <td>
                      <span title={l.origem}>{ORIGEM_ICONE[l.origem] ?? ""}</span> {l.descricao}
                      {l.parcela && <span className="detalhe"> · parcela {l.parcela}</span>}
                      {l.estabelecimento && <div className="detalhe">{l.estabelecimento}</div>}
                    </td>
                    <td>
                      <select
                        value={l.categoria_id}
                        onChange={(e) => alterar(l.id, { categoria_id: Number(e.target.value) })}
                        aria-label="Categoria"
                      >
                        {categorias.map((c) => (
                          <option key={c.id} value={c.id}>{c.emoji} {c.nome}</option>
                        ))}
                      </select>
                    </td>
                    <td className="esconder-celular">{membro(l.membro_id)}</td>
                    <td className="num">
                      {reais(Number(l.valor))}
                      {l.forma_pagamento && <div className="detalhe">{FORMAS_PAGAMENTO[l.forma_pagamento]}</div>}
                    </td>
                    <td>
                      <div className="acoes">
                        {(l.itens?.length ?? 0) > 0 && (
                          <button className="botao icone" onClick={() => setAberto(aberto === l.id ? null : l.id)} title="Itens do cupom">🧾</button>
                        )}
                        {l.comprovante_path && (
                          <button className="botao icone" onClick={() => verComprovante(l.comprovante_path!)} title="Ver comprovante">📎</button>
                        )}
                        <button className="botao icone perigo" onClick={() => excluir(l)} title="Apagar">✕</button>
                      </div>
                    </td>
                  </tr>
                  {aberto === l.id && l.itens && (
                    <tr>
                      <td />
                      <td colSpan={5}>
                        {l.itens.map((it, i) => (
                          <div key={i} className="detalhe">
                            {it.quantidade ? `${it.quantidade}× ` : ""}{it.descricao} — {reais(Number(it.valor_total))}
                          </div>
                        ))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="detalhe">
          📷 foto · 🎙️ áudio · 💬 texto · 📄 documento · 🖥️ painel. Mude a categoria direto na lista.
        </p>
      </section>
    </div>
  );
}

function NovoGasto({ base, aoSalvar }: { base: Pick<Base, "categorias" | "membros">; aoSalvar: () => void }) {
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [membroId, setMembroId] = useState("");
  const [data, setData] = useState(hojeISO());
  const [erro, setErro] = useState("");

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    try {
      ok(
        await supabase.from("lancamentos").insert({
          valor: Number(valor.replace(",", ".")),
          descricao,
          categoria_id: Number(categoriaId),
          membro_id: membroId || null,
          data,
          origem: "painel",
        }),
      );
      setValor("");
      setDescricao("");
      setErro("");
      aoSalvar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  return (
    <form className="cartao formulario" onSubmit={salvar} style={{ marginBottom: 12 }}>
      <Erro erro={erro} />
      <label className="campo">
        Valor (R$)
        <input required inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} style={{ width: 110 }} />
      </label>
      <label className="campo" style={{ flex: 1, minWidth: 160 }}>
        Descrição
        <input required value={descricao} onChange={(e) => setDescricao(e.target.value)} />
      </label>
      <label className="campo">
        Categoria
        <select required value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
          <option value="">Escolha…</option>
          {base.categorias.filter((c) => c.ativa).map((c) => (
            <option key={c.id} value={c.id}>{c.emoji} {c.nome}</option>
          ))}
        </select>
      </label>
      <label className="campo">
        Quem
        <select value={membroId} onChange={(e) => setMembroId(e.target.value)}>
          <option value="">—</option>
          {base.membros.map((m) => (
            <option key={m.id} value={m.id}>{m.nome}</option>
          ))}
        </select>
      </label>
      <label className="campo">
        Data
        <input type="date" required value={data} onChange={(e) => setData(e.target.value)} />
      </label>
      <button className="botao primario">Adicionar gasto</button>
    </form>
  );
}
