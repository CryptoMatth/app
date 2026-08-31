import React, { useState } from 'react';
import { View, TextInput, Pressable, StyleSheet, TextInputProps, StyleProp, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { theme } from './theme';

/**
 * TextInput used exclusively for passwords, with a toggle to show / hide.
 * Keep autoCapitalize/autoCorrect off by default so mobile keyboards don't
 * mangle the first character.
 *
 * The `style` prop is applied to the WRAPPER (so callers can control
 * height/marginBottom/etc exactly as they would on a raw TextInput).
 */
type Props = Omit<TextInputProps, 'secureTextEntry' | 'style'> & {
  toggleTestID?: string;
  style?: StyleProp<ViewStyle>;
};

export function PasswordInput({ toggleTestID, style, ...rest }: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <View style={[styles.wrap, style]}>
      <TextInput
        {...rest}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        placeholderTextColor={theme.color.onSurfaceTertiary}
      />
      <Pressable
        onPress={() => setVisible(v => !v)}
        style={styles.eyeBtn}
        hitSlop={10}
        testID={toggleTestID || 'password-toggle'}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Nascondi password' : 'Mostra password'}
      >
        <Feather
          name={visible ? 'eye-off' : 'eye'}
          size={18}
          color={theme.color.onSurfaceTertiary}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    // caller controls height/margin via style prop
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    height: '100%',
    color: theme.color.onSurface,
    fontSize: 15,
    paddingRight: 6, // small gap before eye
  },
  eyeBtn: {
    width: 40,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
