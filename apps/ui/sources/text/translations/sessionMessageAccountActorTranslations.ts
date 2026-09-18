import type { SupportedLanguage } from '../_all';

type AccountActorTranslations = {
    accountActorYou: string;
    accountActorFormerMember: string;
    accountActorUnnamedMember: string;
    accountActorSentBy: (params: { name: string }) => string;
};

export const sessionMessageAccountActorTranslations: Record<SupportedLanguage, AccountActorTranslations> = {
    en: { accountActorYou: 'You', accountActorFormerMember: 'Former member', accountActorUnnamedMember: 'Happier member', accountActorSentBy: ({ name }) => `Sent by ${name}` },
    ca: { accountActorYou: 'Tu', accountActorFormerMember: 'Antic membre', accountActorUnnamedMember: 'Membre de Happier', accountActorSentBy: ({ name }) => `Enviat per ${name}` },
    de: { accountActorYou: 'Du', accountActorFormerMember: 'Ehemaliges Mitglied', accountActorUnnamedMember: 'Happier-Mitglied', accountActorSentBy: ({ name }) => `Gesendet von ${name}` },
    es: { accountActorYou: 'Tú', accountActorFormerMember: 'Antiguo miembro', accountActorUnnamedMember: 'Miembro de Happier', accountActorSentBy: ({ name }) => `Enviado por ${name}` },
    fr: { accountActorYou: 'Toi', accountActorFormerMember: 'Ancien membre', accountActorUnnamedMember: 'Membre de Happier', accountActorSentBy: ({ name }) => `Envoyé par ${name}` },
    it: { accountActorYou: 'Tu', accountActorFormerMember: 'Ex membro', accountActorUnnamedMember: 'Membro di Happier', accountActorSentBy: ({ name }) => `Inviato da ${name}` },
    ja: { accountActorYou: 'あなた', accountActorFormerMember: '元メンバー', accountActorUnnamedMember: 'Happierメンバー', accountActorSentBy: ({ name }) => `${name}からのメッセージ` },
    pl: { accountActorYou: 'Ty', accountActorFormerMember: 'Były członek', accountActorUnnamedMember: 'Członek Happier', accountActorSentBy: ({ name }) => `Wysłane przez: ${name}` },
    pt: { accountActorYou: 'Você', accountActorFormerMember: 'Ex-membro', accountActorUnnamedMember: 'Membro do Happier', accountActorSentBy: ({ name }) => `Enviado por ${name}` },
    ru: { accountActorYou: 'Вы', accountActorFormerMember: 'Бывший участник', accountActorUnnamedMember: 'Участник Happier', accountActorSentBy: ({ name }) => `Отправитель: ${name}` },
    'zh-Hans': { accountActorYou: '你', accountActorFormerMember: '前成员', accountActorUnnamedMember: 'Happier 成员', accountActorSentBy: ({ name }) => `发送者：${name}` },
    'zh-Hant': { accountActorYou: '你', accountActorFormerMember: '前成員', accountActorUnnamedMember: 'Happier 成員', accountActorSentBy: ({ name }) => `傳送者：${name}` },
};
