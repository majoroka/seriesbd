# Roadmap

## Estado atual
- MVP funcional disponível como PWA offline-first.
- Biblioteca local com gestão completa (watchlist, arquivo, notas, ratings).
- Integração com TMDb/Trakt via funções Netlify e cache de temporadas.
- Estatísticas com gráficos e exportações, import/export completo da base local.

## Curto prazo (próximos sprints)
1. **Qualidade e testes**
   - Expandir Vitest/Testing Library para cobrir fluxos críticos (adicionar série, marcar episódios, import/export).
   - Introduzir testes de regressão para `updateNextAired` e `processInBatches`.
2. **Resiliência de rede**
   - Implementar retries/exponencial para chamadas Trakt (com feedback na UI).
   - Guardar fila de ações offline (marcações de episódios) para sincronizar quando a API voltar.
3. **UX das secções dinâmicas**
   - Paginação/scroll infinito em populares e estreias com placeholders skeleton.
   - Guardar estado dos filtros (dia/semana) nos trending.
4. **Documentação viva**
   - Adicionar guias rápidos (vídeo/gifs) e FAQ ao README.
   - Automatizar lint/checks de documentação no CI.

## Médio prazo
1. **Sincronização multi-dispositivo**
   - Investigar backend simples (Netlify KV / Supabase) para sincronizar biblioteca opcionalmente.
   - Autenticação leve (OAuth TMDb/Trakt ou magic link) para utilizadores que desejem sync.
2. **Notificações e alertas**
   - Push notifications para episódios novos (APIs Web Push + background sync).
   - Alertas agendados para estreias marcadas como favoritas.
3. **Internacionalização e acessibilidade**
   - Externalizar strings e suportar pelo menos en-US.
   - Auditar navegação por teclado, roles ARIA e contrastes.
4. **Mobile-first**
   - Refinar layout responsivo, incorporar gestures e atalhos (p.ex. swipe para marcar visto).

## Longo prazo / visão
1. **Recomendações personalizadas**
   - Analisar ratings/notas para sugerir novas séries (modelos simples + dados Trakt).
   - Integrar com listas públicas do Trakt ou Perfis TMDb.
2. **Partilha e colaboração**
   - Permitir partilhar bibliotecas ou listas com outros utilizadores (modo leitura).
3. **Aplicação nativa**
   - Avaliar wrapper Capacitor/Tauri para distribuição desktop/mobile com notificações nativas.
4. **Ecossistema**
   - Expor uma API pública (GraphQL/REST) para integrações de terceiros.

## Iniciativas de suporte
- **CI/CD:** Configurar pipeline Netlify com testes automáticos, lint e upload de coverage.
- **Observabilidade:** Adicionar captura de erros (Sentry) e métricas de performance Web Vitals.
- **Analytics:** Instrumentar eventos chave (adicionar série, exportar dados, marcações) com consentimento.

## Riscos e dependências
- **APIs externas:** Limites de rate e mudanças contractuais do TMDb/Trakt obrigam a monitorização contínua.
- **Persistência local:** IndexedDB varia por browser; é importante manter rutinas de migração/testes cross-browser.
- **Recursos:** Algumas funcionalidades (sync, push) exigem backend adicional e orçamento para infraestrutura.

