import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Base } from "../App";
import { Erro } from "../componentes";
import {
  dataCurta,
  dataPadrao,
  dividirParcelas,
  FORMAS_PAGAMENTO,
  type Lancamento,
  lerValor,
  limitesMes,
  ok,
  reais,
  somarMesesData,
  supabase,
} from "../dados";

const ORIGEM_ICONE: Record<string, string> = { foto: "📷", audio: "🎙️", texto: "💬", documento: "📄", painel: "" };

export default function Lancamentos(base: Base) {
  const { mes, categorias, membros } = base;
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroMembro, setFiltroMembro] = useState("");
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<number | null>(null);
  const [editando, setEditando] = useState<Lancamento | null>(null);

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
    setEditando(null);
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

  async function alterarCategoria(id: number, categoria_id: number) {
    try {
      ok(await supabase.from("lancamentos").update({ categoria_id }).eq("id", id));
      setLancamentos((ls) => ls.map((l) => (l.id === id ? { ...l, categoria_id } : l)));
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function excluir(l: Lancamento) {
    if (!confirm(`Apagar "${l.descricao}" de ${reais(Number(l.valor))}?`)) return;
    try {
      ok(await supabase.from("lancamentos").delete().eq("id", l.id));
      setLancamentos((ls) => ls.filter((x) => x.id !== l.id));
      if (editando?.id === l.id) setEditando(null);
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
      <FormularioGasto
        key={editando?.id ?? "novo"}
        base={base}
        editando={editando}
        aoSalvar={() => {
          setEditando(null);
          carregar();
        }}
        aoCancelar={() => setEditando(null)}
      />

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
                <tr><td colSpan={6} className="vazio">Nenhum gasto neste mês ainda. Lance no formulário acima.</td></tr>
              )}
              {filtrados.map((l) => (
                <Fragment key={l.id}>
                  <tr style={editando?.id === l.id ? { outline: "2px solid var(--acento)", outlineOffset: -2 } : undefined}>
                    <td>{dataCurta(l.data)}</td>
                    <td>
                      {ORIGEM_ICONE[l.origem] && <span title={l.origem}>{ORIGEM_ICONE[l.origem]} </span>}
                      {l.descricao}
                      {l.parcela && <span className="detalhe"> · parcela {l.parcela}</span>}
                      {l.conta_fixa_id && <span className="detalhe"> · conta fixa</span>}
                      {l.estabelecimento && <div className="detalhe">{l.estabelecimento}</div>}
                    </td>
                    <td>
                      <select
                        value={l.categoria_id}
                        onChange={(e) => alterarCategoria(l.id, Number(e.target.value))}
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
                        <button
                          className="botao icone"
                          onClick={() => {
                            setEditando(l);
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}
                          title="Editar"
                        >✎</button>
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
        <p className="detalhe">Mude a categoria direto na lista. ✎ edita o gasto no formulário acima.</p>
      </section>
    </div>
  );
}

/**
 * Formulário para lançar gastos em sequência: depois de salvar, mantém categoria,
 * pessoa, data e forma de pagamento, limpa valor e descrição e volta o cursor ao valor.
 */
function FormularioGasto({
  base,
  editando,
  aoSalvar,
  aoCancelar,
}: {
  base: Base;
  editando: Lancamento | null;
  aoSalvar: () => void;
  aoCancelar: () => void;
}) {
  const { mes, categorias, membros, eu } = base;
  const [valor, setValor] = useState(editando ? String(editando.valor).replace(".", ",") : "");
  const [descricao, setDescricao] = useState(editando?.descricao ?? "");
  const [estabelecimento, setEstabelecimento] = useState(editando?.estabelecimento ?? "");
  const [categoriaId, setCategoriaId] = useState(editando ? String(editando.categoria_id) : "");
  const [membroId, setMembroId] = useState(editando ? editando.membro_id ?? "" : eu?.id ?? "");
  const [forma, setForma] = useState(editando?.forma_pagamento ?? "");
  const [data, setData] = useState(editando?.data ?? dataPadrao(mes));
  const [parcelas, setParcelas] = useState("1");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [ultimo, setUltimo] = useState("");
  const campoValor = useRef<HTMLInputElement>(null);

  // Ao trocar de mês, a data padrão acompanha (só para lançamentos novos).
  useEffect(() => {
    if (!editando) setData(dataPadrao(mes));
  }, [mes, editando]);

  // A lista de pessoas chega depois do primeiro render: preenche "quem" quando chegar.
  useEffect(() => {
    if (!editando && !membroId && eu) setMembroId(eu.id);
  }, [eu, editando, membroId]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const total = lerValor(valor);
    if (!(total > 0)) return setErro("Informe um valor maior que zero.");
    setSalvando(true);
    try {
      const comum = {
        descricao: descricao.trim(),
        estabelecimento: estabelecimento.trim() || null,
        categoria_id: Number(categoriaId),
        membro_id: membroId || null,
        forma_pagamento: forma || null,
      };
      if (editando) {
        ok(await supabase.from("lancamentos").update({ ...comum, valor: total, data }).eq("id", editando.id));
      } else {
        const n = Math.max(1, Math.min(48, Math.floor(Number(parcelas)) || 1));
        const linhas = dividirParcelas(total, n).map((v, i) => ({
          ...comum,
          valor: v,
          data: somarMesesData(data, i),
          parcela: n > 1 ? `${i + 1}/${n}` : null,
          origem: "painel",
        }));
        ok(await supabase.from("lancamentos").insert(linhas));
        setUltimo(`✓ ${comum.descricao} · ${reais(total)}${n > 1 ? ` em ${n}×` : ""}`);
        setValor("");
        setDescricao("");
        setEstabelecimento("");
        setParcelas("1");
        campoValor.current?.focus();
      }
      setErro("");
      aoSalvar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form className="cartao formulario" onSubmit={salvar} style={{ marginBottom: 12 }}>
      <h2 style={{ width: "100%", margin: 0 }}>
        {editando ? `Editar gasto de ${dataCurta(editando.data)}` : "Lançar gasto"}
        {!editando && ultimo && <small>{ultimo}</small>}
      </h2>
      {erro && <div style={{ width: "100%" }}><Erro erro={erro} /></div>}
      <label className="campo">
        Valor (R$)
        <input ref={campoValor} required inputMode="decimal" placeholder="0,00" value={valor}
          onChange={(e) => setValor(e.target.value)} style={{ width: 110 }} autoFocus />
      </label>
      <label className="campo" style={{ flex: 1, minWidth: 150 }}>
        Descrição
        <input required value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Compras do mês" />
      </label>
      <label className="campo" style={{ flex: 1, minWidth: 130 }}>
        Onde
        <input value={estabelecimento} onChange={(e) => setEstabelecimento(e.target.value)} placeholder="Loja (opcional)" />
      </label>
      <label className="campo">
        Categoria
        <select required value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
          <option value="">Escolha…</option>
          {categorias.filter((c) => c.ativa || String(c.id) === categoriaId).map((c) => (
            <option key={c.id} value={c.id}>{c.emoji} {c.nome}</option>
          ))}
        </select>
      </label>
      <label className="campo">
        Pagamento
        <select value={forma} onChange={(e) => setForma(e.target.value)}>
          <option value="">—</option>
          {Object.entries(FORMAS_PAGAMENTO).map(([id, nome]) => (
            <option key={id} value={id}>{nome}</option>
          ))}
        </select>
      </label>
      <label className="campo">
        Quem
        <select value={membroId} onChange={(e) => setMembroId(e.target.value)}>
          <option value="">—</option>
          {membros.map((m) => (
            <option key={m.id} value={m.id}>{m.nome}</option>
          ))}
        </select>
      </label>
      <label className="campo">
        Data
        <input type="date" required value={data} onChange={(e) => setData(e.target.value)} />
      </label>
      {!editando && (
        <label className="campo">
          Parcelas
          <input type="number" min="1" max="48" value={parcelas} onChange={(e) => setParcelas(e.target.value)} style={{ width: 70 }}
            title="Compra parcelada: informe o valor total; cada parcela cai em um mês" />
        </label>
      )}
      <button className="botao primario" disabled={salvando}>{editando ? "Salvar alteração" : "Lançar"}</button>
      {editando && <button type="button" className="botao" onClick={aoCancelar}>Cancelar</button>}
    </form>
  );
}
