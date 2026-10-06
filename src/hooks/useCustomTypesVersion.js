import { useSyncExternalStore } from "react";
import {
  getCustomTypesVersion,
  subscribeCustomTypes,
} from "../utils/customTypes";

/**
 * Re-renders the calling component when the shared custom types change, so
 * code that reads them through utils/customTypes shows the current set.
 */
export default function useCustomTypesVersion() {
  return useSyncExternalStore(subscribeCustomTypes, getCustomTypesVersion);
}
