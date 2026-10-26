-- Uso só pelo painel: o telefone (WhatsApp) deixa de ser obrigatório.
-- Quem entra no painel é identificado pelo e-mail.
alter table membros alter column telefone drop not null;
