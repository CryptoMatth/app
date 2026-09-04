// Icon font loader for Expo apps. Fonts are loaded from a CDN only under
// Expo Go (StoreClient) — that's where the icon library's .ttf files come
// back as 0 bytes from Metro's asset resolver. Native dev/prod builds and
// web pass an empty map, so useFonts resolves to [true, null] immediately
// via react-native-vector-icons autolinking / web stubs.
//
// This app only actively imports `Feather` from @react-native-vector-icons.
// Usage: const [loaded, error] = useIconFonts();

import Constants, { ExecutionEnvironment } from "expo-constants";
import { useFonts } from "expo-font";

// Version of @react-native-vector-icons/feather in package.json.
// When bumping the package, also update this constant.
const RN_VECTOR_ICONS_VERSION = "13.1.3";

// The Feather library shipped by @react-native-vector-icons registers its
// font under the family name "Feather" and reads it via the "Feather.ttf"
// asset. Load only the families this app actually uses to keep bundle small.
const ICON_FAMILIES: Record<string, string> = {
  Feather: "Feather",
};

const cdnUrl = (file: string): string =>
  `https://cdn.jsdelivr.net/npm/@react-native-vector-icons/${file.toLowerCase()}@${RN_VECTOR_ICONS_VERSION}/fonts/${file}.ttf`;

const iconFontMap = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(ICON_FAMILIES).map(([key, file]) => [key, cdnUrl(file)]),
  );

export const useIconFonts = (): readonly [boolean, Error | null] =>
  useFonts(
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient
      ? iconFontMap()
      : {},
  );
