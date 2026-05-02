/**
 * Magic-link — Français.
 *
 * Magic-link login is deferred (CONTEXT.md §deferred). The template exists
 * now so future v1.1 enabling is a config change, not a content shipment.
 */
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';

export const subject = 'Votre lien de connexion';

interface Props {
  loginUrl: string;
  expiresInMinutes: number;
}

export default function MagicLinkFr({ loginUrl, expiresInMinutes }: Props) {
  return (
    <Html lang="fr">
      <Head />
      <Preview>Votre lien de connexion pour VTTL Topsport</Preview>
      <Body style={{ fontFamily: 'system-ui, sans-serif', lineHeight: 1.5, color: '#1a1a1a' }}>
        <Container>
          <Heading style={{ color: '#0066cc' }}>Votre lien de connexion</Heading>
          <Text>
            Cliquez sur le bouton ci-dessous pour vous connecter à VTTL Topsport. Aucun
            mot de passe requis.
          </Text>
          <Section style={{ margin: '24px 0' }}>
            <Link
              href={loginUrl}
              style={{
                background: '#0066cc',
                color: '#fff',
                padding: '12px 24px',
                textDecoration: 'none',
                borderRadius: 4,
                display: 'inline-block',
              }}
            >
              Se connecter
            </Link>
          </Section>
          <Text style={{ color: '#666', fontSize: 14 }}>
            Ou copiez ce lien dans votre navigateur : {loginUrl}
          </Text>
          <Text style={{ color: '#666', fontSize: 14 }}>
            Ce lien expire dans {expiresInMinutes} minutes. Si vous n&apos;êtes pas à
            l&apos;origine de cette demande, vous pouvez ignorer cet e-mail.
          </Text>
          <Hr style={{ margin: '32px 0', border: 0, borderTop: '1px solid #eee' }} />
          <Text style={{ color: '#999', fontSize: 12 }}>
            VTTL — Ligue Flamande de Tennis de Table · vttl.be
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
