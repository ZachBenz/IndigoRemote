
#
# This file is the default set of rules to compile a Pebble project.
#
# Feel free to customize this to your needs.
#

# Use the python sh module to run the jshint command
from sh import jshint

top = '.'
out = 'build'

def options(ctx):
    ctx.load('pebble_sdk')

def configure(ctx):
    ctx.load('pebble_sdk')
    # Always pass the '--config pebble-jshintrc' option to jshint
    jshint.bake(['--config', 'pebble-jshintrc'])

def build(ctx):
    ctx.load('pebble_sdk')

    # Run jshint before compiling the app.
    jshint("src/js/pebble-js-app.js")

    ctx.pbl_program(source=ctx.path.ant_glob('src/**/*.c'),
                    target='pebble-app.elf')

    ctx.pbl_bundle(elf='pebble-app.elf',
                   js=ctx.path.ant_glob('src/js/**/*.js'))
