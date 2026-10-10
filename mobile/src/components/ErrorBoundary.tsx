import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';

/**
 * Catches render-time crashes and shows them instead of a blank screen.
 *
 * On a device we cannot read the logcat, so this is the fastest way for a user
 * to tell us WHY the app did not open: the message is on screen.
 */
interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  info: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, info: '' };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    this.setState({ info: info?.componentStack ?? '' });
    // Also surface it where a developer would look.
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null, info: '' });
  };

  render(): React.ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.container}>
        <Text style={styles.icon}>⚠️</Text>
        <Text style={styles.title}>Proqramda xəta baş verdi</Text>

        <View style={styles.box}>
          <Text style={styles.label}>Xəta:</Text>
          <Text style={styles.message} selectable>
            {error.message || String(error)}
          </Text>
        </View>

        {info ? (
          <ScrollView style={styles.stackBox}>
            <Text style={styles.stack} selectable>
              {info.trim()}
            </Text>
          </ScrollView>
        ) : null}

        <Pressable onPress={this.reset} style={styles.button}>
          <Text style={styles.buttonText}>Yenidən cəhd et</Text>
        </Pressable>

        <Text style={styles.hint}>Bu məlumatı şirkət admininə göndərin.</Text>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F8FB', padding: 20, justifyContent: 'center', gap: 12 },
  icon: { fontSize: 40, textAlign: 'center' },
  title: { fontSize: 18, fontWeight: '700', color: '#0B4F6C', textAlign: 'center' },
  box: { backgroundColor: '#FFEBEE', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#C62828' },
  label: { fontSize: 11, color: '#C62828', fontWeight: '700' },
  message: { fontSize: 13, color: '#12232E', marginTop: 4 },
  stackBox: { maxHeight: 180, backgroundColor: '#ECEFF1', borderRadius: 10, padding: 12 },
  stack: { fontSize: 10, color: '#5A6B78', fontFamily: 'monospace' },
  button: { backgroundColor: '#0B4F6C', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  hint: { textAlign: 'center', fontSize: 11, color: '#5A6B78' },
});
