fs    = require 'fs'
path  = require 'path'
child = require 'child_process'

rmdir = (dir) ->
  list = fs.readdirSync dir
  for entry in list
    remove(dir, entry)

  console.log "removing #{dir}"
  fs.rmdirSync dir


remove = (dir, entry) ->
  filename = path.join(dir, entry)
  stat = fs.statSync filename
  if entry is '.' or entry is '..'
    #
  else if stat.isDirectory()
    rmdir filename
  else
    console.log "removing #{filename}"
    fs.unlinkSync filename


isdir = (dir) ->
  try
    fs.statSync(dir).isDirectory()
  catch
    false

if isdir 'src'
  rmdir 'lib' if isdir 'lib'
  coffee_bin = path.join 'node_modules', '.bin', 'coffee'
  child.exec "#{coffee_bin} -b -c -o lib/ src/", (err) ->
    if err
      console.error err
