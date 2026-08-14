#include "../client/client.h"
#include "web_local.h"

#include <emscripten/emscripten.h>
#include <stdio.h>
#include <string.h>

unsigned sys_frame_time;

static void Web_Frame(void) {
	static unsigned frames;
	if (frames < 3) {
		fprintf(stdout, "[quake3-wasm] browser frame %u\n", frames + 1);
	}
	frames++;
	Com_Frame();
}

int main(int argc, char **argv) {
	char commandLine[MAX_STRING_CHARS];
	int i;

	commandLine[0] = '\0';
	for (i = 1; i < argc; ++i) {
		if (strlen(commandLine) + strlen(argv[i]) + 2 >= sizeof(commandLine)) {
			fprintf(stderr, "[quake3-wasm] command line is too long\n");
			return 1;
		}
		if (commandLine[0]) {
			Q_strcat(commandLine, sizeof(commandLine), " ");
		}
		Q_strcat(commandLine, sizeof(commandLine), argv[i]);
	}

	fprintf(stdout, "[quake3-wasm] starting official id Tech 3 engine\n");
	Sys_SetDefaultInstallPath("/data");
	Sys_SetDefaultHomePath("/persist");
	Sys_SetDefaultCDPath("");
	Com_Init(commandLine);
	/* The browser launcher has already validated the owner's complete retail
	 * PAK set. Keep the retired physical-CD key gate from covering the menu;
	 * remote master/authorize networking is disabled in this milestone. */
	Q_strncpyz(cl_cdkey, "2222222222222222", sizeof(cl_cdkey));
	NET_Init();
	emscripten_set_main_loop(Web_Frame, 0, 1);
	return 0;
}
