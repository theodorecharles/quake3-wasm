#include "../client/client.h"

qboolean SNDDMA_Init(void) {
	Com_Printf("[quake3-wasm] audio disabled in first browser milestone\n");
	return qfalse;
}
int SNDDMA_GetDMAPos(void) { return 0; }
void SNDDMA_Shutdown(void) {}
void SNDDMA_BeginPainting(void) {}
void SNDDMA_Submit(void) {}
