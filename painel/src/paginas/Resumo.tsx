import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Base } from "../App";
import { BarrasHorizontais, Erro, Indicador, StatusConta, useCores } from "../componentes";
import { FORMAS_PAGAMENTO, nomeMes, ok, reais, reaisCurto, type Resumo as TResumo, supabase } from "../dados";

interface Mes {
  mes: string;
  gasto_total: number;
  gasto_variavel: number;
}

export default function Resumo({ mes }: Base) {
  const [resumo, setResumo] = useState<TResumo | null>(null);
  const [historico, setHistorico] = useState<Mes[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const cores = useCores();

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    Promise.all([
      supabase.rpc("resumo_mes", { p_mes: `${mes}-01` }),
      supabase.rpc("historico_meses", { p_meses: 6 }),
    ])
      .then(([r, h]) => {
        if (!ativo) return;
        setResumo(ok(r) as TResumo);
        setHistorico(ok(h) as Mes[]);
        setErro("");
      })
      .catch((e) => ativo && setErro(e.message))
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [mes]);

  if (!resumo) return <Erro erro={erro} />;

  const orcamento = resumo.orcamento_total;
  const usado = orcamento ? resumo.gasto_total / orcamento : 0;
  const totalMembros = resumo.por_membro.reduce((s, m) => s + m.total, 0);
  const pendentes = resumo.contas_fixas.filter((c) => !c.pago);

  return (
    <div className={carregando ? "carregando" : ""}>
      <Erro erro={erro} />

      <section className="cartao heroi">
        <div>
          <div className="rotulo">Gasto em {nomeMes(mes)}</div>
          <div className="valor">{reais(resumo.gasto_total)}</div>
          {orcamento ? (
            <>
              <div className={`medidor${usado > 1 ? " estourou" : ""}`} role="meter" aria-valuenow={Math.round(usado * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Uso do orçamento">
                <div style={{ width: `${Math.min(usado, 1) * 100}%` }} />
              </div>
              <div className="sub">
                {usado > 1 ? "⚠ " : ""}
                {Math.round(usado * 100)}% do orçamento de {reais(orcamento)}
                {usado <= 1 && ` · sobram ${reais(orcamento - resumo.gasto_total)}`}
                {resumo.dias_restantes > 0 && ` · ${resumo.dias_restantes} dias até o fim do mês`}
              </div>
            </>
          ) : (
            <div className="sub">Defina um orçamento da casa em “Orçamento e ajustes”.</div>
          )}
        </div>
        <div className="sub">
          Variáveis {reais(resumo.gasto_variavel)} · Contas fixas {reais(resumo.contas_fixas_pagas)}
        </div>
      </section>

      <div className="grade-cartoes secao">
        <Indicador
          rotulo="Receita prevista"
          valor={reais(resumo.receita_prevista)}
          sub={resumo.receitas_extras > 0 ? `inclui ${reais(resumo.receitas_extras)} de extras` : "média das entradas recorrentes"}
        />
        <Indicador
          rotulo="Contas fixas a pagar"
          valor={reais(resumo.contas_fixas_pendente)}
          sub={`${pendentes.length} de ${resumo.contas_fixas.length} pendentes · previsto ${reais(resumo.contas_fixas_previsto)}`}
        />
        <Indicador
          rotulo="Gasto projetado"
          valor={reais(resumo.gasto_projetado)}
          sub="gasto até agora + contas fixas pendentes"
        />
        <Indicador
          rotulo="Saldo previsto"
          valor={reais(resumo.saldo_previsto)}
          sub={resumo.saldo_previsto < 0 ? "⚠ gastos acima da receita" : "receita − gasto projetado"}
        />
      </div>

      <div className="duas-colunas">
        <section className="cartao">
          <h2>Por categoria</h2>
          <BarrasHorizontais
            vazio="Nenhum gasto neste mês."
            itens={resumo.por_categoria.map((c) => ({
              chave: c.categoria,
              nome: `${c.emoji ?? ""} ${c.categoria}`.trim(),
              valor: c.total,
              orcamento: c.orcamento,
            }))}
          />
        </section>

        <section className="cartao">
          <h2>Onde mais gastamos <small>sem contas fixas</small></h2>
          <BarrasHorizontais
            vazio="Nenhum gasto neste mês."
            itens={resumo.por_estabelecimento.map((e) => ({
              chave: e.estabelecimento,
              nome: e.estabelecimento,
              valor: e.total,
              detalhe: `${e.compras}×`,
            }))}
          />
        </section>
      </div>

      <div className="duas-colunas">
        <section className="cartao">
          <h2>Últimos 6 meses</h2>
          <div style={{ height: 220 }} role="img" aria-label="Gasto total por mês nos últimos 6 meses">
            <ResponsiveContainer>
              <BarChart data={historico} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke={cores.grade} />
                <XAxis
                  dataKey="mes"
                  tickFormatter={(m: string) => nomeMes(m).slice(0, 3)}
                  stroke={cores.grade}
                  tick={{ fill: cores.texto3, fontSize: 12 }}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)} mil` : String(v))}
                  stroke="none"
                  tick={{ fill: cores.texto3, fontSize: 12 }}
                  width={48}
                />
                <Tooltip
                  cursor={{ fill: cores.grade, opacity: 0.5 }}
                  content={({ active, payload }) =>
                    active && payload?.length ? (
                      <div className="dica-grafico">
                        <strong>{reais((payload[0].payload as Mes).gasto_total)}</strong>
                        <span>{nomeMes((payload[0].payload as Mes).mes)}</span>
                        <br />
                        <span>variáveis {reais((payload[0].payload as Mes).gasto_variavel)}</span>
                      </div>
                    ) : null}
                />
                <Bar dataKey="gasto_total" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
                  {historico.map((h) => (
                    <Cell key={h.mes} fill={h.mes === mes ? cores.acento : cores.neutro} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="detalhe">Mês selecionado em destaque.</p>
        </section>

        <section className="cartao">
          <h2>Quem gastou</h2>
          {totalMembros > 0 ? (
            <>
              <div style={{ display: "flex", gap: 2, height: 16 }} role="img" aria-label="Divisão do gasto por pessoa">
                {resumo.por_membro.map((m, i) => (
                  <div
                    key={m.membro}
                    title={`${m.membro}: ${reais(m.total)}`}
                    style={{
                      flex: m.total,
                      background: cores.series[i % cores.series.length],
                      borderRadius: i === 0 ? "4px 0 0 4px" : i === resumo.por_membro.length - 1 ? "0 4px 4px 0" : 0,
                    }}
                  />
                ))}
              </div>
              <div className="legenda">
                {resumo.por_membro.map((m, i) => (
                  <span key={m.membro}>
                    <i style={{ background: cores.series[i % cores.series.length] }} />
                    {m.membro} · {reais(m.total)} ({Math.round((m.total / totalMembros) * 100)}%)
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p className="vazio">Nenhum gasto neste mês.</p>
          )}

          <h2 style={{ marginTop: 20 }}>Forma de pagamento</h2>
          <table>
            <tbody>
              {resumo.por_forma_pagamento.map((f) => (
                <tr key={f.forma}>
                  <td>{FORMAS_PAGAMENTO[f.forma] ?? "Não informado"}</td>
                  <td className="num">{reais(f.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="cartao secao">
        <h2>Contas fixas do mês</h2>
        {resumo.contas_fixas.length === 0 ? (
          <p className="vazio">Nenhuma conta fixa cadastrada.</p>
        ) : (
          <div className="tabela-rolagem">
            <table>
              <thead>
                <tr>
                  <th>Conta</th>
                  <th className="esconder-celular">Vence</th>
                  <th className="num">Previsto</th>
                  <th className="num esconder-celular">Pago</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {resumo.contas_fixas.map((c) => (
                  <tr key={c.id}>
                    <td>{c.nome}</td>
                    <td className="esconder-celular">{c.dia_vencimento ? `dia ${c.dia_vencimento}` : "—"}</td>
                    <td className="num">{reais(c.valor_previsto)}</td>
                    <td className="num esconder-celular">{c.pago ? reais(c.valor_pago) : "—"}</td>
                    <td><StatusConta pago={c.pago} dia={c.dia_vencimento} mes={mes} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="detalhe">Total previsto {reaisCurto(resumo.contas_fixas_previsto)} por mês.</p>
      </section>
    </div>
  );
}
